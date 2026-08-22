import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

interface TaskInput {
  id: string
  title: string
  notes?: string
  subtasks?: Array<{ title: string; done: boolean }>
}

interface FeedbackExample {
  original: string
  suggested: string
  userVersion?: string
  channel?: string
  outcome: 'accepted' | 'edited' | 'rejected'
}

interface RelatedProject {
  title: string
  category: string
  status: string
  activeTasks: string[]
}

interface MakeActionableRequest {
  tasks: TaskInput[]
  project: {
    title: string
    category?: string
    notes?: string
    waitingOn?: Array<{ person: string; since: string }>
  }
  contextName?: string        // e.g. "Boat Local" — the work context this project belongs to
  relatedProjects?: RelatedProject[]  // other projects in the same context
  userTools: string[]
  recentFeedback?: FeedbackExample[]
}

interface ResultConcrete {
  taskId: string
  type: 'concrete'
  newTitle: string
  channel?: string
  draftMessage?: string
  reasoning?: string
}

interface ResultSubtasks {
  taskId: string
  type: 'subtasks'
  newTitle?: string
  subtasks: Array<{ title: string }>
  reasoning?: string
}

interface ResultAlternatives {
  taskId: string
  type: 'alternatives'
  alternatives: Array<{ title: string; channel?: string; draftMessage?: string }>
  reasoning?: string
}

type Result = ResultConcrete | ResultSubtasks | ResultAlternatives

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' })
    return
  }

  try {
    const body = req.body as MakeActionableRequest

    if (!body?.tasks || body.tasks.length === 0) {
      res.status(400).json({ error: 'No tasks provided' })
      return
    }
    if (body.tasks.length > 30) {
      res.status(400).json({ error: 'Max 30 tasks per call' })
      return
    }

    const userTools = body.userTools && body.userTools.length > 0
      ? body.userTools
      : ['Slack', 'Gmail', 'Boat Local admin', 'phone']

    const recentFeedback = body.recentFeedback ?? []

    const fewShot = recentFeedback
      .filter(e => e.outcome === 'accepted' || e.outcome === 'edited')
      .slice(0, 15)
      .map(e => {
        const final = e.userVersion ?? e.suggested
        const ch = e.channel ? ` [${e.channel}]` : ''
        return `  - "${e.original}" → "${final}"${ch}`
      })
      .join('\n')

    const projectContext = [
      `Project: "${body.project.title}"`,
      body.project.category ? `Categorie: ${body.project.category}` : '',
      body.contextName ? `Bedrijfscontext: ${body.contextName}` : '',
      body.project.notes ? `Project aantekeningen:\n${body.project.notes.slice(0, 1500)}` : '',
      body.project.waitingOn && body.project.waitingOn.length > 0
        ? `Wachten op: ${body.project.waitingOn.map(w => w.person).join(', ')}`
        : '',
      body.relatedProjects && body.relatedProjects.length > 0
        ? `Andere actieve projecten in "${body.contextName ?? 'zelfde context'}":\n` +
          body.relatedProjects.map(p =>
            `  - "${p.title}" [${p.category}/${p.status}]` +
            (p.activeTasks.length > 0 ? `: ${p.activeTasks.slice(0, 4).join(', ')}` : '')
          ).join('\n')
        : '',
    ].filter(Boolean).join('\n')

    const taskList = body.tasks.map(t => {
      const subs = t.subtasks && t.subtasks.length > 0
        ? ` (subtaken: ${t.subtasks.map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('; ')})`
        : ''
      return `  id=${t.id}: "${t.title}"${subs}`
    }).join('\n')

    const systemPrompt = `Je bent een productiviteitsassistent die taken transformeert tot concrete next-actions volgens David Allen's GTD-principe.

Voor elke taak die je krijgt, classificeer hem in een van drie categorieën en geef de bijbehorende output:

1. "concrete" — de taak is klein en kan met één concrete actie. Schrijf een nieuwe titel die letterlijk de eerstvolgende fysieke handeling beschrijft. Suggereer een channel uit de lijst van tools van deze gebruiker als dat past. Voeg optioneel een concept-bericht toe als het channel Slack/Gmail/phone is.
2. "subtasks" — de taak is te groot voor één actie en moet gesplitst in 2 tot 5 concrete deelacties. Eerste subtaak is de eerstvolgende fysieke actie.
3. "alternatives" — de taak is ambigue en er zijn 2 tot 3 zinnige routes. Geef de opties; de gebruiker kiest er een.

Tools beschikbaar voor de gebruiker (gebruik bij voorkeur uit deze lijst voor channel-veld):
${userTools.map(t => `  - ${t}`).join('\n')}

Regels:
- Schrijf in dezelfde taal als de input (vaak Nederlands).
- Houd titels onder 80 tekens.
- Concrete titels beginnen met een werkwoord en specificeren wie/wat/waar.
- Vermijd vage werkwoorden zoals "regelen", "uitzoeken", "kijken naar". Vervang door specifieke acties: "mailen", "bellen", "openen in", "kopiëren naar".
- Concept-berichten (draftMessage) zijn kort, vriendelijk, klaar om te plakken. Alleen toevoegen als de taak menselijke communicatie vereist.
- Reasoning is optioneel maar kort (max 1 zin).
- taskId moet exact overeenkomen met een id uit de takenlijst.
- type moet exact "concrete", "subtasks" of "alternatives" zijn.
${fewShot ? `

Voorbeelden van eerder werk van deze gebruiker (gebruik als toon-/stijl-referentie):
${fewShot}` : ''}`

    const userMessage = `${projectContext}

Taken om te transformeren:
${taskList}`

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
      ],
      tools: [{
        name: 'submit_actionable_results',
        description: 'Submit the transformed, actionable version of each task',
        input_schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string' },
                  type: { type: 'string', enum: ['concrete', 'subtasks', 'alternatives'] },
                  newTitle: { type: 'string' },
                  channel: { type: 'string' },
                  draftMessage: { type: 'string' },
                  subtasks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { title: { type: 'string' } },
                      required: ['title'],
                    },
                  },
                  alternatives: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        channel: { type: 'string' },
                        draftMessage: { type: 'string' },
                      },
                      required: ['title'],
                    },
                  },
                  reasoning: { type: 'string' },
                },
                required: ['taskId', 'type'],
              },
            },
          },
          required: ['results'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_actionable_results' },
    })

    const toolUse = message.content.find(block => block.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      res.status(500).json({ error: 'No response from model' })
      return
    }

    const parsed = toolUse.input as { results?: Result[] }
    const results = Array.isArray(parsed.results) ? parsed.results : []

    res.status(200).json({ results })
  } catch (err) {
    console.error('make-actionable error:', err)
    res.status(500).json({ error: 'Make actionable failed' })
  }
}
