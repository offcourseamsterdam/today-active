import { memo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Sun, Target, X } from 'lucide-react'
import { CategoryBadge } from '../ui/CategoryBadge'
import { WaitingEntryRow } from '../ui/WaitingEntryRow'
import { CardMenu } from './CardMenu'
import { daysSince, normalizeWaitingOn } from '../../lib/utils'
import { CATEGORY_CONFIG } from '../../types'
import type { Project } from '../../types'
import { useStore } from '../../store'

const EMPTY_CONTEXTS: never[] = []

interface ProjectCardProps {
  project: Project
  onClick?: () => void
  isDragOverlay?: boolean
}

export const ProjectCard = memo(function ProjectCard({ project, onClick, isDragOverlay }: ProjectCardProps) {
  const [showObjectiveMenu, setShowObjectiveMenu] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, data: { type: 'project', project } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const contexts = useStore(s => s.settings.contexts ?? EMPTY_CONTEXTS)
  const isLoadingArtwork = useStore(s => s.artworkLoadingIds.includes(project.id))
  const activeContexts = contexts.filter(c => project.contextIds?.includes(c.id))
  const addToTodayPlan = useStore(s => s.addToTodayPlan)
  const isInToday = useStore(s => (s.dailyPlan?.itemOrder ?? []).some(i => i.id === project.id))
  const goals = useStore(s => s.goals)
  const assignProjectToGoal = useStore(s => s.assignProjectToGoal)

  const currentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null

  const totalTasks = project.tasks.length
  const doneTasks = project.tasks.filter(t => t.status === 'done').length
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const categoryConfig = CATEGORY_CONFIG[project.category]

  const waitingEntries = normalizeWaitingOn(project.waitingOn)

  // Done items fade
  const isDone = project.status === 'done'

  // Next-up task: the active task that's been waiting longest (oldest createdAt)
  // — surfaces what's most at risk of being neglected, not what was just added
  const nextTask = project.tasks
    .filter(t => t.status !== 'done' && t.status !== 'dropped')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0]

  const wrapperProps = isDragOverlay
    ? {}
    : { ref: setNodeRef, style, ...attributes, ...listeners }

  return (
    <div
      {...wrapperProps}
      onClick={onClick}
      className={`group rounded-[8px] mb-3 cursor-grab select-none overflow-hidden
        border transition-all duration-150
        ${isDragging
          ? 'opacity-0 pointer-events-none'
          : 'bg-card border-transparent shadow-card hover:border-border hover:shadow-card-hover'}
        ${isDone && !isDragging ? 'opacity-60' : ''}`}
    >
      {/* Cover image strip */}
      {project.coverImageUrl ? (
        <div className="h-28 overflow-hidden relative">
          <img
            src={project.coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            style={{
              objectPosition: project.coverImagePosition
                ? `${project.coverImagePosition.x}% ${project.coverImagePosition.y}%`
                : '50% 50%'
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: categoryConfig.color }}
          />
          <div className="absolute top-2 left-2">
            <CategoryBadge category={project.category} />
          </div>
        </div>
      ) : isLoadingArtwork ? (
        /* Shimmer skeleton while artwork is being fetched */
        <div className="h-28 rounded-t-[8px] relative overflow-hidden bg-border-light">
          <div className="absolute inset-0 animate-pulse"
            style={{
              background: `linear-gradient(90deg, transparent 0%, ${categoryConfig.color}18 50%, transparent 100%)`,
              backgroundSize: '200% 100%',
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] animate-pulse"
            style={{ background: categoryConfig.color, opacity: 0.3 }}
          />
          <div className="absolute top-2 left-2">
            <CategoryBadge category={project.category} />
          </div>
        </div>
      ) : (
        <div
          className="h-20 rounded-t-[8px] relative overflow-hidden"
          style={{ background: categoryConfig.bg }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${categoryConfig.color}28 0%, ${categoryConfig.color}08 100%)`,
            }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px]"
            style={{ background: categoryConfig.color, opacity: 0.5 }}
          />
          <div className="absolute top-2 left-2">
            <CategoryBadge category={project.category} />
          </div>
        </div>
      )}

      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-[14px] font-medium text-charcoal leading-snug">{project.title}</div>
          {!isDragOverlay && (
            <div className="flex items-center gap-0.5 shrink-0 relative">
              {!isDone && !isInToday && (
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); addToTodayPlan(project.id, 'project', 'maintenance') }}
                  title="Voeg toe aan Today"
                  className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone transition-all"
                >
                  <Sun size={14} />
                </button>
              )}
              <div className="relative">
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setShowObjectiveMenu(!showObjectiveMenu) }}
                  title={currentGoal ? `Assigned to: ${currentGoal.title}` : "Assign to objective"}
                  className={`opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-all ${
                    currentGoal ? 'text-amber-600 opacity-100 group-hover:opacity-100' : 'text-stone'
                  }`}
                >
                  <Target size={14} />
                </button>

                {showObjectiveMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-card border border-border rounded-[6px] shadow-lg z-50 min-w-[200px]">
                    <div className="py-1">
                      {currentGoal && (
                        <>
                          <button
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation()
                              assignProjectToGoal(project.id, null)
                              setShowObjectiveMenu(false)
                            }}
                            className="w-full text-left px-3 py-1.5 text-[12px] text-stone/60 hover:bg-border-light flex items-center gap-2 transition-colors"
                          >
                            <X size={12} />
                            Clear
                          </button>
                          <div className="h-px bg-border/30 my-1" />
                        </>
                      )}
                      {goals.length === 0 ? (
                        <div className="px-3 py-2 text-[12px] text-stone/40 italic">
                          No objectives yet
                        </div>
                      ) : (
                        goals.map(goal => (
                          <button
                            key={goal.id}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation()
                              assignProjectToGoal(project.id, goal.id)
                              setShowObjectiveMenu(false)
                            }}
                            className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                              project.goalId === goal.id
                                ? 'bg-border-light text-charcoal font-medium'
                                : 'text-stone/70 hover:bg-border-light'
                            }`}
                          >
                            {goal.title}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <CardMenu id={project.id} type="project" />
            </div>
          )}
        </div>

        {/* Context labels */}
        {activeContexts.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {activeContexts.map(ctx => (
              <span key={ctx.id} className="text-[10px] text-stone/45 uppercase tracking-[0.06em]">
                {ctx.name}
              </span>
            ))}
          </div>
        )}

        {/* Objective badge */}
        {currentGoal && (
          <div className="mb-1.5 flex items-center gap-1 text-[10px]">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: currentGoal.color }}
            />
            <span className="text-stone/60">{currentGoal.title}</span>
          </div>
        )}

        {/* Next task */}
        {!isDone && (
          nextTask
            ? <div className="text-[11px] text-stone/55 mb-2 leading-snug">{nextTask.title}</div>
            : <div className="text-[11px] text-stone/30 mb-2 italic">Plan next task</div>
        )}

        {totalTasks > 0 && (
          <div className="text-[11px] text-stone text-right">
            {doneTasks}/{totalTasks}
          </div>
        )}

        {/* Progress bar */}
        {totalTasks > 0 && project.status === 'in_progress' && (
          <div className="h-0.5 bg-border-light rounded-full mt-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progressPct}%`, background: categoryConfig.color }}
            />
          </div>
        )}

        {/* Days worked */}
        {project.trackProgress && project.daysWorked > 0 && (
          <div className="text-[11px] font-medium mt-2" style={{ color: categoryConfig.color }}>
            {project.daysWorked} day{project.daysWorked !== 1 ? 's' : ''} worked
          </div>
        )}

        {/* Waiting entries — hidden on in_progress cards (shown on cross-listed card in Waiting column instead) */}
        {waitingEntries.length > 0 && project.status !== 'in_progress' && (
          <div className="mt-2 flex flex-col -mx-1" onPointerDown={e => e.stopPropagation()}>
            {waitingEntries.map((entry, i) => (
              <WaitingEntryRow
                key={i}
                entry={entry}
                entryIndex={i}
                projectId={project.id}
                projectTitle={project.title}
                onLabelClick={onClick}
              />
            ))}
          </div>
        )}

        {/* Klaar completion info */}
        {isDone && (
          <div className="text-[11px] text-stone mt-1.5">
            Completed {daysSince(project.updatedAt) === 0
              ? 'today'
              : daysSince(project.updatedAt) === 1
                ? 'yesterday'
                : `${daysSince(project.updatedAt)} days ago`}
          </div>
        )}
      </div>
    </div>
  )
})
