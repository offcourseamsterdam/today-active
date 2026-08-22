import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

function checkOrDefault(v: unknown): { pass: boolean; note: string } {
  if (v && typeof v === 'object' && typeof (v as { pass?: unknown }).pass === 'boolean') {
    return v as { pass: boolean; note: string }
  }
  return { pass: false, note: '' }
}

const SMART_CHECK_SCHEMA = {
  type: 'object' as const,
  properties: {
    pass: { type: 'boolean' as const },
    note: { type: 'string' as const },
  },
  required: ['pass', 'note'],
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
    return
  }

  try {
    const {
      title, description, startDate, targetDate, targetDaysWorked,
      linkedProjectTitles, otherActiveGoalTitles, personalRules,
    } = req.body as {
      title: string
      description?: string
      startDate: string
      targetDate: string
      targetDaysWorked?: number
      linkedProjectTitles: string[]
      otherActiveGoalTitles: string[]
      personalRules: string[]
    }

    if (!title || !targetDate) {
      res.status(400).json({ error: 'title and targetDate are required' })
      return
    }

    const lines: string[] = [
      `Goal title: ${title}`,
      `Description: ${description || '(none provided)'}`,
      `Start date: ${startDate}`,
      `Target date: ${targetDate}`,
      `Target days worked: ${targetDaysWorked ?? '(none set)'}`,
      `Linked projects: ${linkedProjectTitles.length > 0 ? linkedProjectTitles.join(', ') : '(none linked yet)'}`,
      `Other active goals: ${otherActiveGoalTitles.length > 0 ? otherActiveGoalTitles.join(', ') : '(none)'}`,
      `User's personal rules: ${personalRules.length > 0 ? personalRules.join('; ') : '(none)'}`,
    ]

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: `You are a sharp, direct business strategy reviewer. You evaluate a single goal against the SMART framework (Specific, Measurable, Achievable, Relevant, Time-bound).

You have no knowledge of this person's business beyond what's given to you. For "Relevant," judge whether the goal's own description explains what business outcome it drives — if it doesn't, say so plainly and ask for it, rather than assuming relevance or fabricating a business rationale you don't have.

Rules:
- Each of the five criteria gets a boolean "pass" and one concise sentence "note".
- If pass is true, the note briefly confirms why.
- If pass is false, the note says exactly what's missing and how to fix it — concrete, not generic ("add a number, e.g. '20 bookings'" not "make it more measurable").
- Specific: is this a concrete outcome, not a vague aspiration or a restated activity?
- Measurable: is there a number or clear threshold to know when it's hit?
- Achievable: given the target date and (if set) target days worked, is the pace realistic? Flag if the timeline looks too tight or suspiciously loose.
- Relevant: does the description explain the business impact? Does it overlap or conflict with the other active goals listed?
- Time-bound: it will always have a target date by construction — flag only if the date seems arbitrary or the description never references the deadline.
- Be brief. No preamble, no encouragement, no exclamation marks.`,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      tools: [{
        name: 'submit_smart_review',
        description: 'Submit the SMART review result for this goal',
        input_schema: {
          type: 'object',
          properties: {
            specific: SMART_CHECK_SCHEMA,
            measurable: SMART_CHECK_SCHEMA,
            achievable: SMART_CHECK_SCHEMA,
            relevant: SMART_CHECK_SCHEMA,
            timeBound: SMART_CHECK_SCHEMA,
          },
          required: ['specific', 'measurable', 'achievable', 'relevant', 'timeBound'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_smart_review' },
    })

    if (message.stop_reason === 'max_tokens') {
      res.status(500).json({ error: 'Response truncated — please try again' })
      return
    }

    const toolUse = message.content.find(block => block.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      res.status(500).json({ error: 'No response from model' })
      return
    }

    const parsed = toolUse.input as Record<string, unknown>
    res.status(200).json({
      specific: checkOrDefault(parsed.specific),
      measurable: checkOrDefault(parsed.measurable),
      achievable: checkOrDefault(parsed.achievable),
      relevant: checkOrDefault(parsed.relevant),
      timeBound: checkOrDefault(parsed.timeBound),
    })
  } catch (err) {
    console.error('Goal review error:', err)
    res.status(500).json({ error: 'Goal review failed' })
  }
}
