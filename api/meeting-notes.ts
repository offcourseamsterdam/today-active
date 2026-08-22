import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

const ACTION_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    assignee: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
  },
  required: ['description', 'assignee', 'dueDate'],
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
    const { transcript, agendaItems, agendaItemTitle, language, context, projectContext } = req.body as {
      transcript: string
      agendaItems?: string[]
      agendaItemTitle?: string  // when set: per-item mode, focused on this single agenda item
      language: string
      context?: string
      projectContext?: string
    }

    if (!transcript) {
      res.status(400).json({ error: 'No transcript provided' })
      return
    }

    const langInstruction = language === 'nl'
      ? 'Respond in Dutch.'
      : language === 'en'
        ? 'Respond in English.'
        : 'Respond in the same language as the transcript.'

    const contextBlock = context?.trim()
      ? `\nAdditional context about this meeting:\n${context.trim()}\n`
      : ''

    const projectBlock = projectContext?.trim()
      ? `\nLinked project context:\n${projectContext.trim()}\n`
      : ''

    const anthropic = new Anthropic({ apiKey })

    if (agendaItemTitle) {
      // ── Per-agenda-item mode ─────────────────────────────────────────────────
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: `You analyze a portion of a meeting transcript that covers one specific agenda item. ${langInstruction}${projectBlock ? ' When a linked project is provided, reference its tasks and context where relevant.' : ''}

Only include content clearly supported by the transcript. Return empty arrays where there is no relevant content.`,
        messages: [
          {
            role: 'user',
            content: `Agenda item: "${agendaItemTitle}"${contextBlock}${projectBlock}\n\nTranscript segment:\n${transcript}`,
          },
        ],
        tools: [{
          name: 'submit_agenda_item_notes',
          description: 'Submit structured notes for this agenda item',
          input_schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: '1-3 sentences covering what was actually discussed and where it landed. Be specific and concrete.' },
              decisions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific decisions or agreements made during this agenda item. Each is a complete, standalone sentence.',
              },
              actionItems: {
                type: 'array',
                items: ACTION_ITEM_SCHEMA,
                description: 'Concrete next actions committed to. Only include clearly assigned or committed tasks. dueDate uses natural language ("end of week", "Friday") — do not invent dates.',
              },
              openQuestions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Questions raised but not resolved, or topics deferred.',
              },
            },
            required: ['summary', 'decisions', 'actionItems', 'openQuestions'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_agenda_item_notes' },
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

      const parsed = toolUse.input as {
        summary?: string
        decisions?: unknown
        actionItems?: unknown
        openQuestions?: unknown
      }
      res.status(200).json({
        summary: parsed.summary ?? '',
        decisions: parsed.decisions ?? [],
        actionItems: parsed.actionItems ?? [],
        openQuestions: parsed.openQuestions ?? [],
      })
    } else {
      // ── Overall meeting summary mode ─────────────────────────────────────────
      const agendaBlock = (agendaItems ?? []).length > 0
        ? `\nMeeting agenda:\n${agendaItems!.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n`
        : ''

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: `You analyze meeting transcripts and produce a high-level overall summary. ${langInstruction} When a linked project is provided, use its tasks, notes, and status to make your analysis more specific and nuanced — reference task names, unresolved blockers, or project status where relevant.

Only include items clearly supported by the transcript. Return empty arrays where there is no relevant content.`,
        messages: [
          {
            role: 'user',
            content: `${agendaBlock}${contextBlock}${projectBlock}\nTranscript:\n${transcript}`,
          },
        ],
        tools: [{
          name: 'submit_meeting_notes',
          description: 'Submit the overall meeting summary',
          input_schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'A focused 2-4 sentence high-level summary of the meeting as a whole: what was the main thrust, what was the overall outcome, what is the most important next step. Write this as an executive overview, not a list of topics.' },
              actionItems: {
                type: 'array',
                items: ACTION_ITEM_SCHEMA,
                description: 'The most important concrete tasks that came out of the entire meeting. For dueDate use natural language like "end of week", "Friday" — do not invent dates.',
              },
              decisions: {
                type: 'array',
                items: { type: 'string' },
                description: 'The key decisions made across the whole meeting. Each is a complete, standalone sentence.',
              },
              openQuestions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Unresolved questions or deferred topics from the whole meeting.',
              },
              outcome: {
                type: 'string',
                enum: ['productive', 'inconclusive', 'needs-followup'],
                description: 'Overall meeting outcome.',
              },
            },
            required: ['summary', 'actionItems', 'decisions', 'openQuestions', 'outcome'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_meeting_notes' },
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

      const parsed = toolUse.input as {
        summary?: string
        actionItems?: unknown
        decisions?: unknown
        openQuestions?: unknown
        outcome?: string
      }
      res.status(200).json({
        summary: parsed.summary ?? '',
        actionItems: parsed.actionItems ?? [],
        decisions: parsed.decisions ?? [],
        openQuestions: parsed.openQuestions ?? [],
        outcome: parsed.outcome ?? 'productive',
      })
    }
  } catch (err) {
    console.error('Meeting notes error:', err)
    res.status(500).json({ error: 'Meeting notes generation failed' })
  }
}
