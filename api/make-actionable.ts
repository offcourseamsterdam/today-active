import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

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

interface MakeActionableRequest {
  tasks: TaskInput[]
  project: {
    title: string
    notes?: string
    waitingOn?: Array<{ person: string; since: string }>
  }
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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'OPENAI_API_KEY not configured' })
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
      body.project.notes ? `Project notes: ${body.project.notes.slice(0, 500)}` : '',
      body.project.waitingOn && body.project.waitingOn.length > 0
        ? `Wachten op: ${body.project.waitingOn.map(w => w.person).join(', ')}`
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
${fewShot ? `

Voorbeelden van eerder werk van deze gebruiker (gebruik als toon-/stijl-referentie):
${fewShot}` : ''}

Antwoord ALTIJD in geldige JSON volgens dit schema:
{
  "results": [
    {
      "taskId": "<id>",
      "type": "concrete" | "subtasks" | "alternatives",
      // concrete:
      "newTitle"?: "string",
      "channel"?: "string",
      "draftMessage"?: "string",
      // subtasks:
      "newTitle"?: "string (optional rewrite of parent task)",
      "subtasks"?: [{ "title": "string" }],
      // alternatives:
      "alternatives"?: [{ "title": "string", "channel"?: "string", "draftMessage"?: "string" }],
      // optional for all:
      "reasoning"?: "string"
    }
  ]
}`

    const userMessage = `${projectContext}

Taken om te transformeren:
${taskList}`

    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      res.status(500).json({ error: 'No response from model' })
      return
    }

    const parsed = JSON.parse(content) as { results?: Result[] }
    const results = Array.isArray(parsed.results) ? parsed.results : []

    res.status(200).json({ results })
  } catch (err) {
    console.error('make-actionable error:', err)
    res.status(500).json({ error: 'Make actionable failed' })
  }
}
