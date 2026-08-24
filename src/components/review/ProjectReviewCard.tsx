import { useState, useRef } from 'react'
import { ChevronRight, ChevronDown, Clock, Trash2, CheckCircle2, GripVertical, Plus, AlertTriangle, X } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Project, ProjectStatus, Task, WaitingOn } from '../../types'
import { useStore } from '../../store'
import { daysSince, getWaitingLabel, getWaitingStatus } from '../../lib/utils'
import { CategoryBadge } from '../ui/CategoryBadge'

interface ProjectReviewCardProps {
  project: Project
  expanded: boolean
  onToggle: () => void
  onNext?: () => void
  onTaskCompleted: () => void
  onTaskDeleted: () => void
  onProjectMoved: () => void
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  in_progress: 'bg-blue-100 text-blue-700',
  waiting: 'bg-amber-100 text-amber-700',
  backlog: 'bg-stone-100 text-stone-600',
  done: 'bg-green-100 text-green-700',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: 'In Progress',
  waiting: 'Waiting',
  backlog: 'Backlog',
  done: 'Done',
}

function getDescriptionSnippet(bodyContent: string, maxLen = 120): string | null {
  if (!bodyContent) return null
  try {
    const blocks = JSON.parse(bodyContent)
    for (const block of blocks) {
      if (block.content && Array.isArray(block.content)) {
        const text = block.content.map((c: { text?: string }) => c.text || '').join('').trim()
        if (text) return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
      }
    }
  } catch { return null }
  return null
}

function SortableTaskRow({
  task,
  onToggle,
  onDelete,
  onRename,
}: {
  task: Task
  onToggle: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (task.status === 'done') return
    setDraft(task.title)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== task.title) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 group py-1">
      <button {...attributes} {...listeners} className="shrink-0 cursor-grab text-stone/20 hover:text-stone/40 touch-none">
        <GripVertical size={14} />
      </button>
      <button onClick={onToggle} className="shrink-0">
        <CheckCircle2
          size={18}
          className={task.status === 'done' ? 'text-green-500' : 'text-border hover:text-green-400 transition-colors'}
          fill={task.status === 'done' ? 'currentColor' : 'none'}
        />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') { setDraft(task.title); setEditing(false) }
          }}
          className="text-[13px] flex-1 bg-transparent border-b border-stone/30 outline-none text-charcoal focus:border-charcoal transition-colors"
        />
      ) : (
        <span
          onClick={startEdit}
          className={`text-[13px] flex-1 ${task.status === 'done' ? 'line-through text-stone cursor-default' : 'text-charcoal cursor-text hover:text-charcoal/70'}`}
        >
          {task.title}
        </span>
      )}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-stone hover:text-red-500 transition-all"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function WaitingOnSection({
  project,
  onUpdate,
}: {
  project: Project
  onUpdate: (id: string, updates: Partial<Project>) => void
}) {
  const [newPerson, setNewPerson] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const waitingOn = project.waitingOn ?? []

  function addWaiting(e: React.FormEvent) {
    e.preventDefault()
    const person = newPerson.trim()
    if (!person) return
    onUpdate(project.id, {
      waitingOn: [...waitingOn, { person, since: new Date().toISOString() }],
    })
    setNewPerson('')
    inputRef.current?.focus()
  }

  function removeWaiting(person: string) {
    onUpdate(project.id, { waitingOn: waitingOn.filter(w => w.person !== person) })
  }

  return (
    <div>
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-stone mb-2">
        Wachten op
      </h4>
      {waitingOn.map((w: WaitingOn) => {
        const days = daysSince(w.since)
        const status = getWaitingStatus(days)
        return (
          <div key={w.person} className="flex items-center gap-2 py-1 group">
            <span className="text-[13px] text-charcoal flex-1">{w.person}</span>
            <span className={`text-[11px] ${status === 'red' ? 'text-red-600' : status === 'amber' ? 'text-amber-600' : 'text-stone'}`}>
              {getWaitingLabel(days)}
            </span>
            <button
              onClick={() => removeWaiting(w.person)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-stone/40 hover:text-red-500 transition-all"
              title="Verwijderen"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
      <form onSubmit={addWaiting} className="flex items-center gap-2 mt-1">
        <Plus size={14} className="text-stone/30 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={newPerson}
          onChange={e => setNewPerson(e.target.value)}
          placeholder="Wachten op..."
          className="flex-1 text-[13px] px-2 py-1 rounded-md border border-transparent bg-transparent outline-none focus:border-border focus:bg-white transition-colors placeholder:text-stone/30"
        />
      </form>
    </div>
  )
}

export default function ProjectReviewCard({
  project,
  expanded,
  onToggle,
  onNext,
  onTaskCompleted,
  onTaskDeleted,
  onProjectMoved,
}: ProjectReviewCardProps) {
  const [newTask, setNewTask] = useState('')
  const [hideDone, setHideDone] = useState(false)
  const updateProject = useStore(s => s.updateProject)
  const moveProject = useStore(s => s.moveProject)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const openTasks = project.tasks.filter(t => t.status !== 'done' && t.status !== 'dropped')
  const doneTaskCount = project.tasks.filter(t => t.status === 'done').length
  const visibleTasks = hideDone ? project.tasks.filter(t => t.status !== 'done') : project.tasks
  const hasWaiting = (project.waitingOn?.length ?? 0) > 0

  const lastActivity = project.daysWorkedLog.length > 0
    ? project.daysWorkedLog[project.daysWorkedLog.length - 1]
    : project.createdAt
  const daysSinceActivity = daysSince(lastActivity)
  const isStale = daysSinceActivity > 14

  const snippet = getDescriptionSnippet(project.bodyContent)

  function toggleTask(taskId: string) {
    const task = project.tasks.find(t => t.id === taskId)
    if (!task) return
    const newStatus = task.status === 'done' ? 'backlog' : 'done'
    updateProject(project.id, {
      tasks: project.tasks.map(t =>
        t.id === taskId
          ? { ...t, status: newStatus, completedAt: newStatus === 'done' ? new Date().toISOString() : undefined }
          : t,
      ),
    })
    if (newStatus === 'done') onTaskCompleted()
  }

  function renameTask(taskId: string, title: string) {
    updateProject(project.id, {
      tasks: project.tasks.map(t => t.id === taskId ? { ...t, title } : t),
    })
  }

  function deleteTask(taskId: string) {
    updateProject(project.id, { tasks: project.tasks.filter(t => t.id !== taskId) })
    onTaskDeleted()
  }

  function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTask.trim()) return
    updateProject(project.id, {
      tasks: [
        { id: crypto.randomUUID(), title: newTask.trim(), status: 'backlog' as const, isRecurring: false, isUncomfortable: false, createdAt: new Date().toISOString() },
        ...project.tasks,
      ],
    })
    setNewTask('')
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = project.tasks.findIndex(t => t.id === active.id)
    const newIndex = project.tasks.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    updateProject(project.id, { tasks: arrayMove(project.tasks, oldIndex, newIndex) })
  }

  function handleMove(newStatus: ProjectStatus) {
    moveProject(project.id, newStatus)
    onProjectMoved()
  }

  return (
    <div className={`border rounded-lg ${isStale ? 'border-l-2 border-l-amber-400 bg-amber-50/30' : 'border-border bg-white'}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas transition-colors rounded-lg"
      >
        {expanded
          ? <ChevronDown size={16} className="text-stone shrink-0" />
          : <ChevronRight size={16} className="text-stone shrink-0" />
        }
        {isStale && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
        <span className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_BADGE[project.status]}`}>
          {STATUS_LABEL[project.status]}
        </span>
        <CategoryBadge category={project.category} />
        <span className="text-[14px] font-medium text-charcoal truncate">
          {project.title}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {hasWaiting && <Clock size={14} className="text-amber-500" />}
          <span className="text-[12px] text-stone">{openTasks.length} open</span>
          <span className={`text-[11px] ${daysSinceActivity > 14 ? 'text-amber-500' : 'text-stone/40'}`}>
            {daysSinceActivity}d
          </span>
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border-light">
            {/* Description snippet */}
            {snippet && (
              <p className="text-[12px] text-stone/60 italic line-clamp-2 mb-3">{snippet}</p>
            )}

            {/* Add task at top */}
            <form onSubmit={handleAddTask} className="flex items-center gap-2 mt-2">
              <Plus size={14} className="text-stone/30 shrink-0" />
              <input
                type="text"
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                placeholder={openTasks.length === 0 ? 'Wat is de eerstvolgende stap?' : 'Taak toevoegen...'}
                className={`flex-1 text-[13px] px-2 py-1.5 rounded-md border border-border outline-none focus:border-stone/40 transition-colors ${
                  openTasks.length === 0 ? 'bg-amber-50 border-amber-200' : 'bg-white'
                }`}
              />
            </form>

            {/* Sortable tasks */}
            {project.tasks.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-medium uppercase tracking-wide text-stone">
                    Taken
                  </h4>
                  {doneTaskCount > 0 && (
                    <button
                      onClick={() => setHideDone(v => !v)}
                      className="text-[11px] text-stone/50 hover:text-stone transition-colors"
                    >
                      {hideDone ? `Toon voltooid (${doneTaskCount})` : 'Verberg voltooid'}
                    </button>
                  )}
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={visibleTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {visibleTasks.map(task => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        onToggle={() => toggleTask(task.id)}
                        onDelete={() => deleteTask(task.id)}
                        onRename={(title) => renameTask(task.id, title)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {/* Waiting-on list */}
            <WaitingOnSection project={project} onUpdate={updateProject} />

            {/* Backlog section labels */}
            {project.status === 'backlog' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-stone/40 mr-0.5">Backlog:</span>
                {(['soon', 'not_yet', 'someday'] as const).map(sec => (
                  <button
                    key={sec}
                    onClick={() => updateProject(project.id, { backlogSection: sec })}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      project.backlogSection === sec
                        ? 'border-charcoal bg-charcoal text-white'
                        : 'border-border text-stone hover:border-stone/40'
                    }`}
                  >
                    {sec === 'soon' ? 'Soon' : sec === 'not_yet' ? 'Not yet' : 'Someday'}
                  </button>
                ))}
              </div>
            )}

            {/* Move buttons */}
            <div className="flex items-center gap-2">
              {project.status !== 'backlog' && (
                <button
                  onClick={() => handleMove('backlog')}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-border text-stone hover:bg-canvas transition-colors"
                >
                  &rarr; Backlog
                </button>
              )}
              {project.status !== 'in_progress' && (
                <button
                  onClick={() => handleMove('in_progress')}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors"
                >
                  &rarr; In progress
                </button>
              )}
              {project.status !== 'done' && (
                <button
                  onClick={() => handleMove('done')}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                >
                  &rarr; Done
                </button>
              )}
              {onNext && (
                <button
                  onClick={onNext}
                  className="ml-auto text-[12px] px-3 py-1.5 rounded-md border border-border text-stone hover:bg-canvas transition-colors"
                >
                  Volgend project &rarr;
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
