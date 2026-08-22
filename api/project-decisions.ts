import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

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
    const { projectTitle, meetings } = req.body as {
      projectTitle: string
      meetings: Array<{
        title: string
        date: string
        decisions: string[]
        actionItems: Array<{ description: string; owner?: string }>
        openQuestions: string[]
      }>
    }

    if (!meetings || meetings.length === 0) {
      res.status(400).json({ error: 'No meetings provided' })
      return
    }

    const meetingLines = meetings.map((m) => {
      const decisions = m.decisions.join('; ')
      const actions = m.actionItems
        .map((a) => `${a.description}${a.owner ? ` (${a.owner})` : ''}`)
        .join('; ')
      return `Meeting: ${m.title} (${m.date})\nDecisions: ${decisions}\nAction items: ${actions}`
    })

    const userMessage = `Project: ${projectTitle}\n\n${meetingLines.join('\n\n')}`

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: `You are a concise meeting analyst. Given decisions and action items from multiple meetings for a project, produce a consolidated summary.

For each decision:
- Extract what was decided (one clear sentence)
- Identify who is responsible (from action item owners, or null if unclear)
- Note which meeting date it came from
- Note the meeting title

Group decisions by theme where natural themes emerge.

Rules:
- Only include actual decisions, not discussion points or open questions
- If a decision from an earlier meeting was revised in a later meeting, show the latest version
- Keep decision text concise (one sentence)
- Themes should be 1-2 words (e.g., "Infrastructure", "Hiring", "Product")
- If no clear themes, return an empty themes array`,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      tools: [{
        name: 'submit_decisions',
        description: 'Submit the consolidated decisions summary',
        input_schema: {
          type: 'object',
          properties: {
            decisions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  decision: { type: 'string' },
                  responsible: { type: ['string', 'null'] },
                  date: { type: 'string' },
                  meetingTitle: { type: 'string' },
                },
                required: ['decision', 'responsible', 'date', 'meetingTitle'],
              },
            },
            themes: {
              type: 'array',
              items: { type: 'string' },
              description: 'short theme labels, max 5',
            },
          },
          required: ['decisions', 'themes'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_decisions' },
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

    const parsed = toolUse.input as { decisions?: unknown; themes?: unknown }
    res.status(200).json({
      decisions: parsed.decisions ?? [],
      themes: parsed.themes ?? [],
    })
  } catch (err) {
    console.error('Project decisions error:', err)
    res.status(500).json({ error: 'Decision consolidation failed' })
  }
}
