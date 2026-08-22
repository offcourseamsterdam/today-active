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
        summary: string
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
      const questions = m.openQuestions.join('; ')
      return `Meeting: ${m.title} (${m.date})\nSummary: ${m.summary}\nDecisions: ${decisions}\nAction items: ${actions}\nOpen questions: ${questions}`
    })

    const userMessage = `Project: ${projectTitle}\n\n${meetingLines.join('\n\n')}`

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: `You summarize recent meeting outcomes for a project. Given the last 1-2 meetings, produce:

1. A short narrative summary (2-3 sentences) of what was decided and committed to. Write naturally, not as bullet points.
2. A structured list of commitments (action items with clear owners).

Rules:
- Keep the summary conversational and concise
- Only include commitments that have a clear action or deliverable
- If no owner is identified, set owner to null
- fromMeeting should be the meeting title`,
      messages: [
        { role: 'user', content: userMessage },
      ],
      tools: [{
        name: 'submit_summary',
        description: 'Submit the recent meeting summary',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '2-3 sentences' },
            commitments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  owner: { type: ['string', 'null'] },
                  fromMeeting: { type: 'string' },
                },
                required: ['description', 'owner', 'fromMeeting'],
              },
            },
          },
          required: ['summary', 'commitments'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_summary' },
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

    const parsed = toolUse.input as { summary?: string; commitments?: unknown }
    res.status(200).json({
      summary: parsed.summary ?? '',
      commitments: parsed.commitments ?? [],
    })
  } catch (err) {
    console.error('Recent meeting summary error:', err)
    res.status(500).json({ error: 'Summary generation failed' })
  }
}
