import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ProjectCard } from './ProjectCard'
import { StandaloneTaskCard } from './StandaloneTaskCard'
import { DropGhost } from '../ui/DropGhost'
import { WaitingEntryRow } from '../ui/WaitingEntryRow'
import { normalizeWaitingOn } from '../../lib/utils'
import { CATEGORY_CONFIG } from '../../types'
import type { Project, ProjectStatus, Task } from '../../types'

interface KanbanColumnProps {
  id: ProjectStatus
  title: string
  projects: Project[]
  orphanTasks: Task[]
  limit: number | null
  combinedCount?: number
  onProjectClick: (project: Project) => void
  onOrphanComplete: (taskId: string) => void
  onOrphanDelete: (taskId: string) => void
  onOrphanAssignProject: (taskId: string, projectId: string) => void
  onOrphanOpenNotes: (task: Task) => void
  onOrphanUpdate: (taskId: string, updates: Partial<Task>) => void
  allProjects: Project[]
  dragPreview?: { activeId: string; afterItemId: string | null; height: number; beforeFirst?: boolean }
  /** Projects from another column that have waitingOn entries — shown as non-draggable linked cards */
  crossListedProjects?: Project[]
}

function CrossListedCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const catConfig = CATEGORY_CONFIG[project.category]
  const waitingEntries = normalizeWaitingOn(project.waitingOn)
  const activeTasks = project.tasks.filter(t => t.status !== 'done')

  return (
    <div
      onClick={onClick}
      className="rounded-[8px] mb-2 border border-dashed border-border cursor-pointer
        bg-card/60 hover:bg-card hover:border-stone/30 transition-all duration-150 overflow-hidden"
    >
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <div className="w-2 h-2 rounded-sm mt-1 flex-shrink-0" style={{ background: catConfig.bg, border: `1px solid ${catConfig.color}40` }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-charcoal/70 truncate">{project.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 border border-blue-100 whitespace-nowrap">
              also active
            </span>
          </div>
          {activeTasks.length > 0 && (
            <div className="mt-1 text-[10px] text-stone/40 truncate">{activeTasks[0].title}</div>
          )}
        </div>
      </div>
      {waitingEntries.length > 0 && (
        <div className="px-3 pb-2 -mt-1" onPointerDown={e => e.stopPropagation()}>
          {waitingEntries.map((entry, i) => (
            <WaitingEntryRow
              key={i}
              entry={entry}
              entryIndex={i}
              projectId={project.id}
              projectTitle={project.title}
              actionsHoverOnly
              onLabelClick={onClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function KanbanColumn({
  id, title, projects, orphanTasks, limit, combinedCount, onProjectClick,
  onOrphanComplete, onOrphanDelete, onOrphanAssignProject, onOrphanOpenNotes, onOrphanUpdate, allProjects,
  dragPreview, crossListedProjects = [],
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const displayCount = combinedCount !== undefined ? combinedCount : projects.length
  const atLimit = limit !== null && displayCount >= limit

  const allIds = [...orphanTasks.map(t => t.id), ...projects.map(p => p.id)]

  // Ghost insertion index within the projects array (for cross-column drop preview)
  const ghostIndex = dragPreview
    ? (() => {
        if (dragPreview.beforeFirst) return 0
        if (!dragPreview.afterItemId) return projects.length
        const idx = projects.findIndex(p => p.id === dragPreview.afterItemId)
        return idx >= 0 ? idx + 1 : projects.length
      })()
    : null

  return (
    <div
      ref={setNodeRef}
      className={`bg-border-light/60 rounded-[10px] p-4 min-h-[300px] transition-colors duration-150
        ${isOver ? 'bg-border-light' : ''}`}
    >
      {/* Column header */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
        <span className="text-[13px] font-semibold text-stone tracking-[0.01em]">{title}</span>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full
            ${atLimit
              ? 'bg-[var(--color-status-amber-bg)] text-[var(--color-status-amber-text)]'
              : 'bg-border text-stone'}`}
        >
          {limit ? `${displayCount} / ${limit}` : projects.length}
        </span>
      </div>

      <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
        {/* Orphan tasks at top */}
        {orphanTasks.map(task => (
          <StandaloneTaskCard
            key={task.id}
            task={task}
            projects={allProjects}
            onComplete={() => onOrphanComplete(task.id)}
            onDelete={() => onOrphanDelete(task.id)}
            onAssignProject={projectId => onOrphanAssignProject(task.id, projectId)}
            onOpenNotes={() => onOrphanOpenNotes(task)}
            onUpdate={updates => onOrphanUpdate(task.id, updates)}
          />
        ))}

        {orphanTasks.length > 0 && projects.length > 0 && (
          <div className="h-px bg-border/40 mb-2" />
        )}

        {/* Projects with ghost placeholder inserted at ghostIndex */}
        {ghostIndex !== null
          ? projects.map((project, i) => (
              <React.Fragment key={project.id}>
                {i === ghostIndex && <DropGhost height={dragPreview!.height} />}
                <ProjectCard
                  project={project}
                  onClick={() => onProjectClick(project)}
                />
              </React.Fragment>
            ))
          : projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => onProjectClick(project)}
              />
            ))
        }
        {/* Ghost at end when index is past last project */}
        {ghostIndex !== null && ghostIndex >= projects.length && <DropGhost height={dragPreview!.height} />}
      </SortableContext>

      {projects.length === 0 && orphanTasks.length === 0 && crossListedProjects.length === 0 && !dragPreview && (
        <div className="text-center text-stone/40 text-[13px] py-8">
          {id === 'backlog' && 'Drop projects here'}
          {id === 'in_progress' && 'Drag projects to start'}
          {id === 'waiting' && 'Nothing waiting'}
          {id === 'done' && 'Nothing completed yet'}
        </div>
      )}

      {/* Cross-listed projects (e.g. in_progress with waitingOn entries shown in waiting column) */}
      {crossListedProjects.length > 0 && (
        <>
          {(projects.length > 0 || orphanTasks.length > 0) && (
            <div className="h-px bg-border/30 my-2" />
          )}
          {crossListedProjects.map(project => (
            <CrossListedCard
              key={`cross-${project.id}`}
              project={project}
              onClick={() => onProjectClick(project)}
            />
          ))}
        </>
      )}
    </div>
  )
}
