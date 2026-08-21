import { useDroppable } from '@dnd-kit/core'
import { format, isToday, isPast, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'
import type { Project, DailyPlan, Goal } from '../../types'
import { WeekProjectCard } from './WeekProjectCard'

interface Props {
  date: Date
  projectIds: string[]
  historyPlan: DailyPlan | null
  projects: Project[]
  goals: Goal[]
  onRemove: (projectId: string) => void
}

function getProjectsFromPlan(plan: DailyPlan, projects: Project[]): Project[] {
  const ids = new Set([
    ...(plan.shortProjects ?? []),
    ...(plan.maintenanceProjects ?? []),
    ...(plan.deepBlock?.projectId ? [plan.deepBlock.projectId] : []),
  ])
  return projects.filter(p => ids.has(p.id))
}

export function WeekDayColumn({ date, projectIds, historyPlan, projects, goals, onRemove }: Props) {
  const dateKey = format(date, 'yyyy-MM-dd')
  const isPastDay = isPast(startOfDay(date)) && !isToday(date)
  const isEditable = !isPastDay

  const { setNodeRef, isOver } = useDroppable({
    id: `col::${dateKey}`,
    data: { toDate: dateKey },
    disabled: !isEditable,
  })

  const displayProjects = historyPlan
    ? getProjectsFromPlan(historyPlan, projects)
    : projects.filter(p => projectIds.includes(p.id))

  const dayLabel = format(date, 'EEE', { locale: nl })
  const dateLabel = format(date, 'd MMM', { locale: nl })

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className={`text-center pb-2 border-b border-border ${isToday(date) ? 'text-charcoal' : 'text-stone/60'}`}>
        <div className={`text-[11px] uppercase tracking-[0.06em] font-medium ${isToday(date) ? 'text-charcoal' : ''}`}>
          {dayLabel}
        </div>
        <div className={`text-[13px] mt-0.5 ${isToday(date) ? 'font-semibold' : ''}`}>
          {dateLabel}
        </div>
        {isToday(date) && (
          <div className="mt-1 w-1.5 h-1.5 rounded-full bg-charcoal mx-auto" />
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`
          flex flex-col gap-1.5 min-h-[120px] rounded-[8px] p-1.5 transition-colors
          ${isOver ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : ''}
          ${isPastDay ? 'opacity-60' : ''}
        `}
      >
        {displayProjects.map(project => (
          <WeekProjectCard
            key={project.id}
            project={project}
            dateKey={dateKey}
            isReadOnly={!isEditable}
            onRemove={isEditable ? () => onRemove(project.id) : undefined}
            goalColor={goals.find(g => g.id === project.goalId)?.color}
          />
        ))}
        {displayProjects.length === 0 && isEditable && (
          <div className="text-[11px] text-stone/30 text-center pt-4 italic">
            sleep project hierheen
          </div>
        )}
      </div>
    </div>
  )
}
