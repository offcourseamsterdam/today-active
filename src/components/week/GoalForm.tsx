import { useState } from 'react'
import { useStore } from '../../store'
import { getTodayString } from '../../store/helpers'
import { GOAL_COLORS, type Goal, type GoalColor } from '../../types'
import { isGoalActive } from '../../lib/goals'

interface Props {
  goal: Goal | null   // null = creating a new goal
  onClose: () => void
}

interface SmartCheck {
  pass: boolean
  note: string
}

interface GoalReviewResult {
  specific: SmartCheck
  measurable: SmartCheck
  achievable: SmartCheck
  relevant: SmartCheck
  timeBound: SmartCheck
}

export function GoalForm({ goal, onClose }: Props) {
  const addGoal = useStore(s => s.addGoal)
  const updateGoal = useStore(s => s.updateGoal)
  const deleteGoal = useStore(s => s.deleteGoal)
  const allGoals = useStore(s => s.goals)
  const projects = useStore(s => s.projects)
  const personalRules = useStore(s => s.personalRules)

  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [startDate, setStartDate] = useState(goal?.startDate ?? getTodayString())
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [targetDaysWorked, setTargetDaysWorked] = useState(
    goal?.targetDaysWorked ? String(goal.targetDaysWorked) : ''
  )
  const [color, setColor] = useState<GoalColor>(goal?.color ?? GOAL_COLORS[0])
  const [review, setReview] = useState<GoalReviewResult | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const canSave =
    title.trim().length > 0 &&
    startDate.length > 0 &&
    targetDate.length > 0 &&
    targetDate >= startDate &&
    (targetDaysWorked === '' || Number(targetDaysWorked) > 0)

  function handleSave() {
    if (!canSave) return
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      startDate,
      targetDate,
      targetDaysWorked: targetDaysWorked ? Number(targetDaysWorked) : undefined,
      color,
    }
    if (goal) {
      updateGoal(goal.id, payload)
    } else {
      addGoal(payload)
    }
    onClose()
  }

  function handleDelete() {
    if (!goal) return
    deleteGoal(goal.id)
    onClose()
  }

  async function handleReview() {
    setReviewLoading(true)
    setReview(null)
    setReviewError(null)
    try {
      const linkedProjectTitles = goal
        ? projects.filter(p => p.goalId === goal.id).map(p => p.title)
        : []
      const otherActiveGoalTitles = allGoals
        .filter(g => g.id !== goal?.id && isGoalActive(g))
        .map(g => g.title)

      const res = await fetch('/api/goal-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          startDate,
          targetDate,
          targetDaysWorked: targetDaysWorked ? Number(targetDaysWorked) : undefined,
          linkedProjectTitles,
          otherActiveGoalTitles,
          personalRules,
        }),
      })

      if (!res.ok) {
        console.error('goal-review API error:', res.status)
        setReviewError('Review mislukt, probeer het opnieuw.')
        return
      }
      const data = await res.json()
      setReview(data)
    } catch (err) {
      console.error('goal-review failed:', err)
      setReviewError('Review mislukt, probeer het opnieuw.')
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-charcoal/20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] max-h-[85vh] overflow-y-auto bg-canvas rounded-t-[16px]
          sm:rounded-[12px] border border-border shadow-2xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-serif text-[17px] text-charcoal">
          {goal ? 'Objective bewerken' : 'Nieuw objective'}
        </h3>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Titel</label>
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setReview(null); setReviewError(null) }}
            placeholder="Wat wil je bereiken?"
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal
              focus:outline-none focus:border-stone/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">
            Waarom — wat levert dit de business op?
          </label>
          <textarea
            value={description}
            onChange={e => { setDescription(e.target.value); setReview(null); setReviewError(null) }}
            rows={3}
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal
              focus:outline-none focus:border-stone/40 resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setReview(null); setReviewError(null) }}
              className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Doeldatum</label>
            <input
              type="date"
              value={targetDate}
              onChange={e => { setTargetDate(e.target.value); setReview(null); setReviewError(null) }}
              className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">
            Target dagen gewerkt (optioneel)
          </label>
          <input
            type="number"
            min={1}
            value={targetDaysWorked}
            onChange={e => { setTargetDaysWorked(e.target.value); setReview(null); setReviewError(null) }}
            placeholder="bv. 20"
            className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal w-24"
          />
        </div>

        <div className="flex items-center gap-2">
          {GOAL_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-charcoal scale-105' : ''
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Kies kleur ${c}`}
            />
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleReview}
            disabled={!canSave || reviewLoading}
            className="self-start px-3 py-1.5 text-[12px] rounded-[6px] border border-border text-stone/70
              hover:text-charcoal hover:border-stone/40 transition-colors disabled:opacity-40"
          >
            {reviewLoading ? 'Beoordelen…' : 'Review objective'}
          </button>

          {reviewError && (
            <div className="text-[11px] text-red">{reviewError}</div>
          )}

          {review && (
            <div className="flex flex-col gap-1.5 rounded-[8px] border border-border bg-border-light/40 p-3">
              {(
                [
                  ['specific', 'Specific'],
                  ['measurable', 'Measurable'],
                  ['achievable', 'Achievable'],
                  ['relevant', 'Relevant'],
                  ['timeBound', 'Time-bound'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex gap-2 text-[11px]">
                  <span className={review[key].pass ? 'text-green' : 'text-red'}>
                    {review[key].pass ? '✓' : '✗'}
                  </span>
                  <span>
                    <span className="font-medium text-charcoal">{label}:</span>{' '}
                    <span className="text-stone/70">{review[key].note ?? ''}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          {goal ? (
            <button onClick={handleDelete} className="text-[12px] text-red hover:opacity-70">
              Verwijder
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] rounded-[6px] text-stone/60 hover:bg-border-light"
            >
              Annuleer
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-3 py-1.5 text-[12px] rounded-[6px] bg-charcoal text-[#FAF9F7] disabled:opacity-40"
            >
              Opslaan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
