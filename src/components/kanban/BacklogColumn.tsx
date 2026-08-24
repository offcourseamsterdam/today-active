import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ProjectCard } from './ProjectCard'
import { StandaloneTaskCard } from './StandaloneTaskCard'
import { DropGhost } from '../ui/DropGhost'
import type { Project, Task } from '../../types'

interface BacklogSectionProps {
  sectionId: 'soon' | 'not_yet' | 'someday'
  title: string
  projects: Project[]
  onProjectClick: (project: Project) => void
  dragPreview?: { afterItemId: string | null; height: number }
}

function BacklogSection({ sectionId, title, projects, onProjectClick, dragPreview }: BacklogSectionProps) {
  const droppableId = `backlog-${sectionId}`
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })

  const ghostIndex = dragPreview
    ? (() => {
        if (!dragPreview.afterItemId) return projects.length
        const idx = projects.findIndex(p => p.id === dragPreview.afterItemId)
        return idx >= 0 ? idx + 1 : projects.length
      })()
    : null

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] rounded-[6px] transition-colors duration-150 -mx-1 px-1 py-1
        ${isOver ? 'bg-border-light' : ''}`}
    >
      <div className="text-[12px] uppercase tracking-[0.06em] text-charcoal/65 font-semibold mb-2 px-1">
        {title}
      </div>
      <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
        {ghostIndex !== null
          ? projects.map((project, i) => (
              <React.Fragment key={project.id}>
                {i === ghostIndex && <DropGhost height={dragPreview!.height} />}
                <ProjectCard project={project} onClick={() => onProjectClick(project)} />
              </React.Fragment>
            ))
          : projects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => onProjectClick(project)} />
            ))
        }
        {ghostIndex !== null && ghostIndex >= projects.length && (
          <DropGhost height={dragPreview!.height} />
        )}
      </SortableContext>
      {projects.length === 0 && !dragPreview && (
        <div className="text-center text-stone/25 text-[12px] py-4 italic">
          Drop here
        </div>
      )}
    </div>
  )
}

interface BacklogColumnProps {
  projects: Project[]
  orphanTasks: Task[]
  onProjectClick: (project: Project) => void
  onOrphanComplete: (taskId: string) => void
  onOrphanDelete: (taskId: string) => void
  onOrphanAssignProject: (taskId: string, projectId: string) => void
  onOrphanOpenNotes: (task: Task) => void
  onOrphanUpdate: (taskId: string, updates: Partial<Task>) => void
  allProjects: Project[]
  backlogDragPreview?: { section: 'soon' | 'not_yet' | 'someday'; afterItemId: string | null; height: number }
}

export function BacklogColumn({
  projects, orphanTasks, onProjectClick,
  onOrphanComplete, onOrphanDelete, onOrphanAssignProject, onOrphanOpenNotes, onOrphanUpdate, allProjects,
  backlogDragPreview,
}: BacklogColumnProps) {
  const soonProjects = projects.filter(p => p.backlogSection === 'soon')
  const notYetProjects = projects.filter(p => !p.backlogSection || p.backlogSection === 'not_yet')
  // backward compat: treat old 'maybe' as 'someday'
  const somedayProjects = projects.filter(p => p.backlogSection === 'someday')

  return (
    <div className="bg-border-light/60 rounded-[10px] p-4 min-h-[300px]">
      {/* Column header */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
        <span className="text-[13px] font-semibold text-stone tracking-[0.01em]">Backlog</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-border text-stone">
          {projects.length}
        </span>
      </div>

      {/* Orphan tasks at top */}
      {orphanTasks.length > 0 && (
        <>
          <SortableContext items={orphanTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="mb-2">
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
            </div>
          </SortableContext>
          <div className="h-px bg-border/40 mb-3" />
        </>
      )}

      {/* Sections */}
      <div className="space-y-3">
        <BacklogSection
          sectionId="soon"
          title="Soon"
          projects={soonProjects}
          onProjectClick={onProjectClick}
          dragPreview={backlogDragPreview?.section === 'soon' ? backlogDragPreview : undefined}
        />
        <div className="h-px bg-border/50" />
        <BacklogSection
          sectionId="not_yet"
          title="Not yet"
          projects={notYetProjects}
          onProjectClick={onProjectClick}
          dragPreview={backlogDragPreview?.section === 'not_yet' ? backlogDragPreview : undefined}
        />
        <div className="h-px bg-border/50" />
        <BacklogSection
          sectionId="someday"
          title="Someday"
          projects={somedayProjects}
          onProjectClick={onProjectClick}
          dragPreview={backlogDragPreview?.section === 'someday' ? backlogDragPreview : undefined}
        />
      </div>
    </div>
  )
}
