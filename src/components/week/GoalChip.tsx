import { format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { getGoalCompletion, getGoalDaysWorked } from '../../lib/goals'
import type { Goal, Project } from '../../types'

interface Props {
  goal: Goal
  projects: Project[]
  onClick: () => void
}

export function GoalChip({ goal, projects, onClick }: Props) {
  const { done, total } = getGoalCompletion(goal, projects)
  const daysWorked = getGoalDaysWorked(goal, projects)
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0
  const targetLabel = format(new Date(goal.targetDate), 'd MMM', { locale: nl })

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 px-3 py-2 rounded-[8px] border border-border bg-canvas text-left
        min-w-[180px] shrink-0 hover:border-stone/30 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: goal.color }} />
        <span className="text-[12px] font-medium text-charcoal truncate">{goal.title}</span>
      </div>
      <div className="text-[10px] text-stone/60">
        {total > 0 ? `${done}/${total} projecten` : 'nog geen projecten'} · doel {targetLabel}
      </div>
      <div className="h-1 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${completionPct}%`, backgroundColor: goal.color }}
        />
      </div>
      {goal.targetDaysWorked && (
        <div className="text-[10px] text-stone/50">
          {daysWorked}/{goal.targetDaysWorked} dagen gewerkt
        </div>
      )}
    </button>
  )
}
