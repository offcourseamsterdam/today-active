import { useState, useCallback, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useStore } from '../../store'
import { KanbanColumn } from './KanbanColumn'
import { BacklogColumn } from './BacklogColumn'
import { ProjectCard } from './ProjectCard'
import { StandaloneTaskCard } from './StandaloneTaskCard'
import { SwapModal } from './SwapModal'
import { WaitingPromptModal } from './WaitingPromptModal'
import { ProjectModal } from './ProjectModal'
import { AddProjectModal } from './AddProjectModal'
import { AddTaskModal } from './AddTaskModal'
import { DoneListColumn } from './DoneListColumn'
import { KANBAN_COLUMNS, type Project, type ProjectStatus, type Task } from '../../types'
import { OrphanTaskModal } from './OrphanTaskModal'
import { ChevronDown, ChevronUp } from 'lucide-react'

const EMPTY_CONTEXTS: never[] = []

interface KanbanBoardProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  externalAddTask?: boolean
  onExternalAddTaskClose?: () => void
  externalAddProject?: boolean
  onExternalAddProjectClose?: () => void
}

// Custom collision detection: pointerWithin (accurate for columns) → closestCorners fallback
const collisionStrategy: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length > 0) return within
  return closestCorners(args)
}

// Derive which kanban column an orphan task belongs to
function getOrphanColumn(task: Task): ProjectStatus {
  if (task.kanbanColumn) return task.kanbanColumn
  if (task.status === 'vandaag') return 'in_progress'
  return 'backlog'
}

export function KanbanBoard({
  collapsed = false,
  onToggleCollapse,
  externalAddTask = false,
  onExternalAddTaskClose,
  externalAddProject = false,
  onExternalAddProjectClose,
}: KanbanBoardProps) {
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const moveProject = useStore(s => s.moveProject)
  const reorderProjects = useStore(s => s.reorderProjects)
  const reorderProjectAfter = useStore(s => s.reorderProjectAfter)
  const reorderProjectToEnd = useStore(s => s.reorderProjectToEnd)
  const reorderProjectToStart = useStore(s => s.reorderProjectToStart)
  const setProjectBacklogSection = useStore(s => s.setProjectBacklogSection)
  const swapModalProjectId = useStore(s => s.swapModalProjectId)
  const inProgressLimit = useStore(s => s.settings.inProgressLimit)
  const getWipCount = useStore(s => s.getWipCount)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const deleteOrphanTask = useStore(s => s.deleteOrphanTask)
  const moveOrphanTaskToProject = useStore(s => s.moveOrphanTaskToProject)
  const contexts = useStore(s => s.settings.contexts) ?? EMPTY_CONTEXTS

  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [activeOrphanTask, setActiveOrphanTask] = useState<Task | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    activeId: string
    targetCol: ProjectStatus
    afterItemId: string | null
    height: number
    beforeFirst?: boolean
  } | null>(null)
  const [dragHeight, setDragHeight] = useState(80)
  const [backlogDragPreview, setBacklogDragPreview] = useState<{
    section: 'soon' | 'not_yet' | 'someday'
    afterItemId: string | null
    height: number
  } | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedOrphanTask, setSelectedOrphanTask] = useState<Task | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [mobileCol, setMobileCol] = useState<string>('backlog')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const visibleProjects = useMemo(
    () => selectedContextId ? projects.filter(p => p.contextIds?.includes(selectedContextId)) : projects,
    [projects, selectedContextId]
  )

  const getProjectsByStatus = useCallback(
    (status: ProjectStatus) => visibleProjects.filter(p => p.status === status),
    [visibleProjects]
  )

  // In-progress projects with waitingOn entries — shown as cross-listed in the waiting column
  const crossListedInWaiting = useMemo(
    () => visibleProjects.filter(p => p.status === 'in_progress' && (p.waitingOn?.length ?? 0) > 0),
    [visibleProjects]
  )

  // Active (non-done, non-dropped) orphan tasks routed to their column
  const activeOrphans = useMemo(
    () => orphanTasks.filter(t => t.status !== 'dropped' && t.status !== 'done'),
    [orphanTasks]
  )
  const getOrphansByColumn = useCallback(
    (col: ProjectStatus) => activeOrphans.filter(t => getOrphanColumn(t) === col),
    [activeOrphans]
  )

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string
    const h = event.active.rect.current.initial?.height ?? 80
    setDragHeight(h)
    const orphan = orphanTasks.find(t => t.id === id)
    if (orphan) {
      setActiveOrphanTask(orphan)
      return
    }
    const project = projects.find(p => p.id === id)
    if (project) setActiveProject(project)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) { setDragPreview(null); setBacklogDragPreview(null); return }
    const activeId = active.id as string
    const overId = over.id as string
    if (activeId === overId) return

    // Backlog section handling — show ghost inside the correct section
    if (overId === 'backlog-soon' || overId === 'backlog-not_yet' || overId === 'backlog-someday' || overId === 'backlog') {
      setDragPreview(null)
      if (!activeOrphanTask) {
        const section = overId === 'backlog-soon' ? 'soon' : overId === 'backlog-someday' ? 'someday' : 'not_yet'
        setBacklogDragPreview({ section, afterItemId: null, height: dragHeight })
      }
      return
    }

    // Determine which column the over target belongs to
    const overColumn = KANBAN_COLUMNS.find(col => col.id === overId)
    const overProject = projects.find(p => p.id === overId)
    const overOrphan = orphanTasks.find(t => t.id === overId)

    // Project card in backlog — show ghost in its section
    if (overProject && overProject.status === 'backlog' && !activeOrphanTask) {
      setDragPreview(null)
      setBacklogDragPreview({
        section: overProject.backlogSection ?? 'not_yet',
        afterItemId: overId,
        height: dragHeight,
      })
      return
    }

    let targetCol: ProjectStatus | null = null
    if (overColumn && overColumn.id !== 'backlog') {
      targetCol = overColumn.id
    } else if (overProject && overProject.status !== 'backlog') {
      targetCol = overProject.status
    } else if (overOrphan) {
      const col = getOrphanColumn(overOrphan)
      if (col !== 'backlog') targetCol = col
    }

    if (!targetCol) { setDragPreview(null); setBacklogDragPreview(null); return }

    // Determine if we should insert before the first card (hovering in upper half of column)
    const isColumnZone = !!overColumn
    let beforeFirst = false
    if (isColumnZone && over) {
      const activeY = active.rect.current.translated?.top ?? 0
      const overRect = over.rect
      beforeFirst = activeY < overRect.top + overRect.height / 2
    }

    setBacklogDragPreview(null)
    setDragPreview({
      activeId,
      targetCol,
      afterItemId: (overProject?.id ?? overOrphan?.id) ?? null,
      height: dragHeight,
      beforeFirst,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const wasOrphan = !!activeOrphanTask
    setDragPreview(null)
    setBacklogDragPreview(null)
    setActiveProject(null)
    setActiveOrphanTask(null)

    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string
    if (activeId === overId) return

    // --- Orphan task drag ---
    if (wasOrphan) {
      // Dropped on a backlog section
      if (overId === 'backlog-soon' || overId === 'backlog-not_yet' || overId === 'backlog-someday') {
        updateOrphanTask(activeId, { kanbanColumn: 'backlog' })
        return
      }
      // Dropped on a column drop zone
      const targetCol = KANBAN_COLUMNS.find(col => col.id === overId)
      if (targetCol) {
        updateOrphanTask(activeId, { kanbanColumn: targetCol.id })
        return
      }
      // Dropped on a project card → adopt that project's column
      const overProject = projects.find(p => p.id === overId)
      if (overProject) {
        updateOrphanTask(activeId, { kanbanColumn: overProject.status })
        return
      }
      // Dropped on another orphan task → adopt its column
      const overOrphan = orphanTasks.find(t => t.id === overId)
      if (overOrphan) {
        updateOrphanTask(activeId, { kanbanColumn: getOrphanColumn(overOrphan) })
        return
      }
      return
    }

    // --- Project drag ---
    if (overId === 'backlog-soon' || overId === 'backlog-not_yet' || overId === 'backlog-someday') {
      const section = overId === 'backlog-soon' ? 'soon' : overId === 'backlog-not_yet' ? 'not_yet' : 'someday'
      const moved = moveProject(activeId, 'backlog')
      if (moved) reorderProjectToEnd(activeId)
      setProjectBacklogSection(activeId, section)
      return
    }

    const targetColumn = KANBAN_COLUMNS.find(col => col.id === overId)
    if (targetColumn) {
      const moved = moveProject(activeId, targetColumn.id)
      if (moved) {
        // Use pointer Y to decide top vs bottom of column
        const activeY = active.rect.current.translated?.top ?? 0
        const overRect = over.rect
        if (overRect && activeY < overRect.top + overRect.height / 2) {
          reorderProjectToStart(activeId)
        } else {
          reorderProjectToEnd(activeId)
        }
      }
      return
    }

    const draggedProject = projects.find(p => p.id === activeId)
    if (!draggedProject) return

    const overProject = projects.find(p => p.id === overId)
    if (!overProject) {
      // overId might be an orphan task card in the target column — use its column
      const overOrphan = orphanTasks.find(t => t.id === overId)
      if (overOrphan) {
        const moved = moveProject(activeId, getOrphanColumn(overOrphan))
        if (moved) reorderProjectToEnd(activeId)
      }
      return
    }

    if (draggedProject.status === overProject.status) {
      reorderProjects(activeId, overId)
      if (draggedProject.status === 'backlog') {
        const targetSection = overProject.backlogSection ?? 'not_yet'
        if ((draggedProject.backlogSection ?? 'not_yet') !== targetSection) {
          setProjectBacklogSection(activeId, targetSection)
        }
      }
    } else {
      const moved = moveProject(activeId, overProject.status)
      if (moved) reorderProjectAfter(activeId, overId)
      if (overProject.status === 'backlog') {
        setProjectBacklogSection(activeId, overProject.backlogSection ?? 'not_yet')
      }
    }
  }

  function handleProjectClick(project: Project) {
    const fresh = useStore.getState().projects.find(p => p.id === project.id)
    setSelectedProject(fresh || project)
  }

  const freshSelectedProject = selectedProject
    ? projects.find(p => p.id === selectedProject.id) || null
    : null

  // Shared orphan handlers for all columns — memoized to avoid re-renders
  const orphanHandlers = useMemo(() => ({
    onOrphanComplete: (taskId: string) => updateOrphanTask(taskId, {
      status: 'done',
      completedAt: new Date().toISOString(),
    }),
    onOrphanDelete: (taskId: string) => deleteOrphanTask(taskId),
    onOrphanAssignProject: (taskId: string, projectId: string) => moveOrphanTaskToProject(taskId, projectId),
    onOrphanOpenNotes: (task: Task) => setSelectedOrphanTask(task),
    onOrphanUpdate: (taskId: string, updates: Partial<Task>) => updateOrphanTask(taskId, updates),
    allProjects: projects,
  }), [projects, updateOrphanTask, deleteOrphanTask, moveOrphanTaskToProject])

  return (
    <>
      <div className="max-w-[1400px] mx-auto">
        {/* Board divider */}
        <div className="flex items-center gap-4 mb-5">
          <button
            onClick={onToggleCollapse}
            className="flex items-center gap-2 text-stone hover:text-charcoal transition-colors group"
          >
            {collapsed
              ? <ChevronDown size={14} className="text-stone/50 group-hover:text-stone transition-colors" />
              : <ChevronUp size={14} className="text-stone/50 group-hover:text-stone transition-colors" />
            }
            <span className="text-[11px] uppercase tracking-[0.08em] font-medium">
              Projects & tasks
            </span>
          </button>
          <div className="flex-1 h-px bg-border" />
        </div>

        {!collapsed && <>

        {/* Context filter tabs */}
        {contexts.length > 0 && (
          <div className="flex items-center gap-1 mb-5">
            <button
              onClick={() => setSelectedContextId(null)}
              className={`text-[11px] px-3 py-1.5 rounded-full transition-all duration-150
                ${selectedContextId === null
                  ? 'bg-charcoal text-canvas'
                  : 'text-stone hover:text-charcoal hover:bg-border-light'}`}
            >
              Alles
            </button>
            {contexts.map(ctx => (
              <button
                key={ctx.id}
                onClick={() => setSelectedContextId(ctx.id)}
                className={`text-[11px] px-3 py-1.5 rounded-full transition-all duration-150
                  ${selectedContextId === ctx.id
                    ? 'bg-charcoal text-canvas'
                    : 'text-stone hover:text-charcoal hover:bg-border-light'}`}
              >
                {ctx.name}
              </button>
            ))}
          </div>
        )}

        {/* Mobile column tabs — hidden on sm+ */}
        <div className="flex sm:hidden gap-1 mb-3 p-1 bg-border-light/60 rounded-[8px]">
          {[
            { id: 'backlog', label: 'Backlog' },
            { id: 'in_progress', label: 'Active' },
            { id: 'waiting', label: 'Waiting' },
            { id: 'done', label: 'Done' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setMobileCol(tab.id)}
              className={`flex-1 py-1.5 text-[11px] font-medium rounded-[6px] transition-all duration-150
                ${mobileCol === tab.id
                  ? 'bg-card text-charcoal shadow-sm'
                  : 'text-stone hover:text-charcoal'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Kanban columns */}
        <DndContext
          sensors={sensors}
          collisionDetection={collisionStrategy}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="sm:grid sm:grid-cols-4 sm:gap-4 flex flex-col gap-3">
            <div className={mobileCol !== 'backlog' ? 'hidden sm:block' : ''}>
              <BacklogColumn
                projects={getProjectsByStatus('backlog')}
                orphanTasks={getOrphansByColumn('backlog')}
                onProjectClick={handleProjectClick}
                backlogDragPreview={backlogDragPreview ?? undefined}
                {...orphanHandlers}
              />
            </div>
            {KANBAN_COLUMNS.filter(col => col.id !== 'backlog').map(col => {
              const isWipColumn = col.id === 'in_progress' || col.id === 'waiting'
              return (
                <div key={col.id} className={mobileCol !== col.id ? 'hidden sm:block' : ''}>
                  <KanbanColumn
                    id={col.id}
                    title={col.title}
                    limit={isWipColumn ? inProgressLimit : null}
                    combinedCount={isWipColumn ? getWipCount() : undefined}
                    projects={getProjectsByStatus(col.id)}
                    orphanTasks={getOrphansByColumn(col.id)}
                    crossListedProjects={col.id === 'waiting' ? crossListedInWaiting : undefined}
                    onProjectClick={handleProjectClick}
                    dragPreview={
                      dragPreview?.targetCol === col.id
                        ? { activeId: dragPreview.activeId, afterItemId: dragPreview.afterItemId, height: dragPreview.height, beforeFirst: dragPreview.beforeFirst }
                        : undefined
                    }
                    {...orphanHandlers}
                  />
                </div>
              )
            })}
            <div className={mobileCol !== 'done' ? 'hidden sm:block' : ''}>
              <DoneListColumn />
            </div>
          </div>

          <DragOverlay>
            {activeProject && (
              <div className="rotate-2 scale-105">
                <ProjectCard project={activeProject} isDragOverlay />
              </div>
            )}
            {activeOrphanTask && (
              <div className="rotate-1 scale-105">
                <StandaloneTaskCard
                  task={activeOrphanTask}
                  projects={projects}
                  onComplete={() => {}}
                  onDelete={() => {}}
                  onAssignProject={() => {}}
                  isDragOverlay
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </> }
      </div>

      {/* Modals */}
      {swapModalProjectId && <SwapModal />}
      <WaitingPromptModal />

      <ProjectModal
        project={freshSelectedProject}
        onClose={() => setSelectedProject(null)}
      />

      {selectedOrphanTask && (
        <OrphanTaskModal
          task={selectedOrphanTask}
          onClose={() => setSelectedOrphanTask(null)}
        />
      )}

      <AddProjectModal
        open={showAddModal || externalAddProject}
        onClose={() => { setShowAddModal(false); onExternalAddProjectClose?.() }}
      />

      <AddTaskModal
        open={showAddTaskModal || externalAddTask}
        onClose={() => { setShowAddTaskModal(false); onExternalAddTaskClose?.() }}
      />
    </>
  )
}
