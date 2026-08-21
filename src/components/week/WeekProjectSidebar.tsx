import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Goal, Project } from '../../types'
import { getGoalCompletion } from '../../lib/goals'

interface Props {
  projects: Project[]
  goals: Goal[]           // active goals only — caller filters
  onEditGoal: (goal: Goal) => void
}

function SidebarCard({ project }: { project: Project }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar::${project.id}`,
    data: { projectId: project.id, fromDate: null },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px]
        font-medium text-charcoal cursor-grab active:cursor-grabbing select-none
        transition-opacity ${isDragging ? 'opacity-40' : 'hover:bg-border-light'}`}
    >
      {project.title}
    </div>
  )
}

function GoalSection({ goal, projects, onEditGoal }: {
  goal: Goal
  projects: Project[]   // FULL list, not pre-filtered by status
  onEditGoal: (goal: Goal) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `goalHeader::${goal.id}`,
    data: { assignGoalId: goal.id },
  })
  const linked = projects.filter(p => p.goalId === goal.id)
  const { done, total } = getGoalCompletion(goal, projects)
  const displayable = linked.filter(p => p.status !== 'done')

  return (
    <div className="flex flex-col gap-1">
      <button
        ref={setNodeRef}
        onClick={() => onEditGoal(goal)}
        className={`flex items-center gap-1.5 text-left rounded-[6px] px-1 py-0.5 -mx-1 transition-colors
          ${isOver ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : 'hover:bg-border-light'}`}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: goal.color }} />
        <span className="text-[10px] uppercase tracking-[0.05em] text-stone/60 font-medium truncate">
          {goal.title}
        </span>
        <span className="text-[9px] text-stone/40 shrink-0 ml-auto">{done}/{total}</span>
      </button>
      {displayable.map(p => <SidebarCard key={p.id} project={p} />)}
    </div>
  )
}

export function WeekProjectSidebar({ projects, goals, onEditGoal }: Props) {
  const workable = projects.filter(p => p.status !== 'done')
  const unassigned = workable.filter(
    p => !p.goalId || !goals.some(g => g.id === p.goalId)
  )

  const { setNodeRef: setUnassignedRef, isOver: isOverUnassigned } = useDroppable({
    id: 'goalHeader::unassigned',
    data: { assignGoalId: null },
  })

  return (
    <div className="flex flex-col gap-3 w-[180px] shrink-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-stone/50 font-medium">Projecten</div>

      {goals.map(goal => (
        <GoalSection
          key={goal.id}
          goal={goal}
          projects={projects}
          onEditGoal={onEditGoal}
        />
      ))}

      <div className="flex flex-col gap-1">
        <div
          ref={setUnassignedRef}
          className={`text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5 rounded-[6px]
            px-1 py-0.5 -mx-1 transition-colors ${isOverUnassigned ? 'bg-charcoal/5 ring-1 ring-charcoal/20' : ''}`}
        >
          Unassigned
        </div>
        {unassigned.map(p => <SidebarCard key={p.id} project={p} />)}
      </div>
    </div>
  )
}
