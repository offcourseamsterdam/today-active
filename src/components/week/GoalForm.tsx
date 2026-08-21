import { useState } from 'react'
import { useStore } from '../../store'
import { GOAL_COLORS, type Goal, type GoalColor } from '../../types'

interface Props {
  goal: Goal | null   // null = creating a new goal
  onClose: () => void
}

export function GoalForm({ goal, onClose }: Props) {
  const addGoal = useStore(s => s.addGoal)
  const updateGoal = useStore(s => s.updateGoal)
  const deleteGoal = useStore(s => s.deleteGoal)

  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [startDate, setStartDate] = useState(goal?.startDate ?? new Date().toISOString().slice(0, 10))
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [targetDaysWorked, setTargetDaysWorked] = useState(
    goal?.targetDaysWorked ? String(goal.targetDaysWorked) : ''
  )
  const [color, setColor] = useState<GoalColor>(goal?.color ?? GOAL_COLORS[0])

  const canSave = title.trim().length > 0 && targetDate.length > 0

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
            onChange={e => setTitle(e.target.value)}
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
            onChange={e => setDescription(e.target.value)}
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
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[13px] text-charcoal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.05em] text-stone/50 font-medium">Doeldatum</label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
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
            onChange={e => setTargetDaysWorked(e.target.value)}
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
