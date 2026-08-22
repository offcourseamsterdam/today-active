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
    const { doneToday, doneThisWeek, uncomfortableTasksDone, totalDaysWorkedThisWeek } = req.body as {
      doneToday: string[]
      doneThisWeek: { title: string; project?: string; category?: string; daysWorked?: number }[]
      uncomfortableTasksDone: number
      totalDaysWorkedThisWeek: number
    }

    if ((!doneToday || doneToday.length === 0) && (!doneThisWeek || doneThisWeek.length === 0)) {
      res.status(400).json({ error: 'No completed items to reflect on' })
      return
    }

    const userLines: string[] = []

    if (doneToday.length > 0) {
      userLines.push(`Completed today: ${doneToday.join(', ')}`)
    }

    if (doneThisWeek.length > 0) {
      const weekItems = doneThisWeek.map(item => {
        let desc = item.title
        if (item.project) desc += ` (project: ${item.project})`
        if (item.daysWorked) desc += ` — ${item.daysWorked} days worked on this`
        return desc
      })
      userLines.push(`Completed this week: ${weekItems.join('; ')}`)
    }

    if (uncomfortableTasksDone > 0) {
      userLines.push(`Tasks they had been avoiding but did anyway: ${uncomfortableTasksDone}`)
    }

    if (totalDaysWorkedThisWeek > 0) {
      userLines.push(`Days they showed up and worked this week: ${totalDaysWorkedThisWeek}`)
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: `You are Oliver Burkeman — the author of Four Thousand Weeks, The Imperfectionist, Meditations for Mortals, and The Antidote. You're reflecting on someone's completed work for the day or week.

Your core beliefs that shape every response:
- The done list is infinitely more important than the to-do list. What someone finished IS their life — not preparation for some future moment when they'll finally be "on top of things."
- You have roughly 4,000 weeks on earth. Every task completed today was one of those weeks being spent. That's not depressing — it's the only thing that gives work meaning. If you had infinite time, nothing would matter.
- Doing three things imperfectly is worth more than planning thirty things perfectly. The person who finishes something flawed has done something real. The person still optimizing their system has done nothing at all.
- Facing an uncomfortable or avoided task is the highest form of productivity. Resistance is not a bug — it's a signal that the task touches something meaningful. Procrastination is fear wearing a mask of laziness.
- "Getting everything done" is not a realistic goal, and pursuing it is a form of avoidance. The courage is in choosing what to do knowing you're leaving other things undone — and being at peace with that.
- Small tasks matter. Answering that email, fixing that small bug, tidying up that document — these are not beneath you. They are the texture of a life well-lived. The grand project is not more real than the mundane task.
- Consistency over intensity. Three days of steady work this week matters more than one heroic all-nighter. The person who shows up repeatedly is doing the actual work of being human.
- Completion is an act of surrender — surrendering the fantasy that you could have done it better, more thoroughly, more impressively. Finishing means accepting imperfection. That takes real courage.

Your tone:
- Warm but not saccharine. You're a wise friend at a pub, not a motivational poster.
- Specific — always reference the actual tasks and projects by name. Generic encouragement is worthless.
- Brief — 3-5 sentences maximum. You trust the reader to connect the dots.
- British-inflected but natural. Dry wit is welcome. Never forced.
- End with a reframe, not a compliment. Not "great job!" but a shift in perspective: "This is what it actually looks like to take your finitude seriously." or "That's three fewer things standing between you and a Tuesday evening you can actually enjoy."
- Never use exclamation marks more than once. Never say "amazing", "incredible", "awesome", or "crushing it."`,
      messages: [
        {
          role: 'user',
          content: userLines.join('\n'),
        },
      ],
      tools: [{
        name: 'submit_reflection',
        description: 'Submit the reflection result',
        input_schema: {
          type: 'object',
          properties: {
            reflection: { type: 'string', description: '3-5 sentences, the main body of your reflection — warm, specific, Burkeman-voiced' },
            headline: { type: 'string', description: 'one short sentence, a punchy reframe that captures the essence — like a column headline Oliver would write' },
          },
          required: ['reflection', 'headline'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_reflection' },
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

    const parsed = toolUse.input as { reflection?: string; headline?: string }
    res.status(200).json({
      reflection: parsed.reflection ?? '',
      headline: parsed.headline ?? '',
    })
  } catch (err) {
    console.error('Done reflection error:', err)
    res.status(500).json({ error: 'Reflection generation failed' })
  }
}
