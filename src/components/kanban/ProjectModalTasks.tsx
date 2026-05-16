import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, Trash2, GripVertical, ChevronRight, X, Sparkles, RefreshCw, Check } from 'lucide-react'
import { MakeActionablePanel } from './MakeActionablePanel'
import { MakeActionableBulkPanel } from './MakeActionableBulkPanel'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../../store'
import { TaskCheckbox } from '../ui/TaskCheckbox'
import { CATEGORY_CONFIG, DEFAULT_USER_TOOLS } from '../../types'
import type { Project, Task } from '../../types'

interface ProjectModalTasksProps {
  project: Project
}

// ─── Inline editable title ──────────────────────────────────────
function InlineTitle({ value, isDone, onSave }: { value: string; isDone: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="text-[13px] text-charcoal flex-1 min-w-0 bg-transparent border-none outline-none
          border-b border-b-[#2A2724]/20 focus:border-b-[#2A2724]/40 py-0"
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`text-[13px] flex-1 min-w-0 cursor-text rounded-[3px]
        hover:bg-[#FAF9F7] px-0.5 -mx-0.5 transition-colors
        ${isDone ? 'text-stone line-through' : 'text-charcoal'}`}
    >
      {value}
    </span>
  )
}

// ─── Subtask list (inline expand) ───────────────────────────────
function SubtaskList({ task, projectId, color }: { task: Task; projectId: string; color: string }) {
  const addSubtask = useStore(s => s.addSubtask)
  const toggleSubtask = useStore(s => s.toggleSubtask)
  const deleteSubtask = useStore(s => s.deleteSubtask)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const subtasks = task.subtasks ?? []

  function handleAdd() {
    const title = newTitle.trim()
    if (!title) return
    addSubtask(projectId, task.id, title)
    setNewTitle('')
    inputRef.current?.focus()
  }

  return (
    <div className="ml-[38px] mb-1 space-y-0.5">
      {subtasks.map(sub => (
        <div key={sub.id} className="flex items-center gap-2 py-0.5 group/sub">
          <button
            onClick={() => toggleSubtask(projectId, task.id, sub.id)}
            className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center flex-shrink-0 transition-colors
              ${sub.done
                ? 'border-transparent'
                : 'border-stone/25 hover:border-stone/40'}`}
            style={sub.done ? { background: color } : undefined}
          >
            {sub.done && (
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M2 5.5L4 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <span className={`text-[12px] flex-1 min-w-0 ${sub.done ? 'text-stone/50 line-through' : 'text-charcoal/80'}`}>
            {sub.title}
          </span>
          <button
            onClick={() => deleteSubtask(projectId, task.id, sub.id)}
            className="opacity-0 group-hover/sub:opacity-50 hover:!opacity-100 text-stone hover:text-red transition-all flex-shrink-0"
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
          placeholder="Add subtask..."
          className="flex-1 text-[11px] text-charcoal/70 placeholder:text-stone/25 bg-transparent border-none outline-none py-0.5"
        />
      </div>
    </div>
  )
}

// ─── Subtask progress chip ──────────────────────────────────────
function SubtaskChip({ task, expanded, onToggle }: { task: Task; expanded: boolean; onToggle: () => void }) {
  const subtasks = task.subtasks ?? []
  const done = subtasks.filter(s => s.done).length
  const total = subtasks.length

  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle() }}
      className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full transition-all flex-shrink-0
        ${expanded
          ? 'bg-charcoal/8 text-charcoal/60'
          : total > 0
            ? 'text-stone/40 hover:text-stone/60 hover:bg-stone/8'
            : 'text-stone/20 opacity-0 group-hover:opacity-100 hover:text-stone/40'}`}
      title={total > 0 ? `${done}/${total} subtasks done` : 'Add subtasks'}
    >
      <ChevronRight size={9} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
      {total > 0 && <span className="tabular-nums">{done}/{total}</span>}
    </button>
  )
}

// ─── Sortable task row ──────────────────────────────────────────
function SortableTaskRow({
  task,
  color,
  projectId,
  onToggle,
  onDelete,
  onRename,
  onMakeActionable,
}: {
  task: Task
  color: string
  projectId: string
  onToggle: () => void
  onDelete: () => void
  onRename: (title: string) => void
  onMakeActionable: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`flex items-center gap-2 py-1.5 group rounded-[6px] transition-all
          ${isDragging ? 'opacity-50 bg-[#FAF9F7] z-10' : ''}`}
      >
        <div
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#7A746A]/0 group-hover:text-[#7A746A]/30
            hover:!text-[#7A746A]/60 transition-colors touch-none flex-shrink-0 -ml-1"
        >
          <GripVertical size={13} />
        </div>
        <TaskCheckbox
          checked={task.status === 'done'}
          onChange={onToggle}
          color={color}
        />
        <InlineTitle value={task.title} isDone={task.status === 'done'} onSave={onRename} />
        <SubtaskChip task={task} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
        <button
          onClick={onMakeActionable}
          title="Maak actionable (AI)"
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone hover:text-amber-600 transition-all"
        >
          <Sparkles size={13} />
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone hover:text-red transition-all"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {expanded && <SubtaskList task={task} projectId={projectId} color={color} />}
    </div>
  )
}

// ─── Static done task row (not draggable) ───────────────────────
function DoneTaskRow({
  task,
  color,
  projectId,
  onToggle,
  onDelete,
  onRename,
}: {
  task: Task
  color: string
  projectId: string
  onToggle: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 group">
        <div className="w-[13px] -ml-1 flex-shrink-0" />
        <TaskCheckbox
          checked
          onChange={onToggle}
          color={color}
        />
        <InlineTitle value={task.title} isDone onSave={onRename} />
        <SubtaskChip task={task} expanded={expanded} onToggle={() => setExpanded(e => !e)} />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone hover:text-red transition-all"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {expanded && <SubtaskList task={task} projectId={projectId} color={color} />}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────
type AiSuggestState =
  | { phase: 'loading' }
  | { phase: 'done'; subtasks: Array<{ title: string; checked: boolean }>; newTitle?: string }

export function ProjectModalTasks({ project }: ProjectModalTasksProps) {
  const addTask = useStore(s => s.addTask)
  const addSubtask = useStore(s => s.addSubtask)
  const updateTask = useStore(s => s.updateTask)
  const deleteTask = useStore(s => s.deleteTask)
  const recordDayWorked = useStore(s => s.recordDayWorked)
  const reorderProjectTasks = useStore(s => s.reorderProjectTasks)
  const userTools = useStore(s => s.settings.userTools ?? DEFAULT_USER_TOOLS)

  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [showAllDone, setShowAllDone] = useState(false)
  const [actionableTaskId, setActionableTaskId] = useState<string | null>(null)
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false)
  const [aiSuggest, setAiSuggest] = useState<AiSuggestState | null>(null)

  async function triggerAISubtasks() {
    const title = newTaskTitle.trim()
    if (!title || aiSuggest?.phase === 'loading') return
    setAiSuggest({ phase: 'loading' })
    try {
      const resp = await fetch('/api/make-actionable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [{ id: '__new__', title }],
          project: { title: project.title },
          userTools,
          recentFeedback: [],
        }),
      })
      if (!resp.ok) { setAiSuggest(null); return }
      const data = await resp.json() as { results: Array<{ type: string; newTitle?: string; subtasks?: Array<{ title: string }>; alternatives?: Array<{ title: string }> }> }
      const result = data.results[0]
      if (!result) { setAiSuggest(null); return }

      if (result.type === 'subtasks' && result.subtasks && result.subtasks.length > 0) {
        setAiSuggest({
          phase: 'done',
          subtasks: result.subtasks.map(s => ({ title: s.title, checked: true })),
          newTitle: result.newTitle,
        })
      } else if (result.type === 'concrete' && result.newTitle) {
        // Task is already specific — refine the title in place
        setNewTaskTitle(result.newTitle)
        setAiSuggest(null)
      } else if (result.type === 'alternatives' && result.alternatives && result.alternatives.length > 0) {
        // Take first alternative as a concrete rewrite
        setNewTaskTitle(result.alternatives[0].title)
        setAiSuggest(null)
      } else {
        setAiSuggest(null)
      }
    } catch {
      setAiSuggest(null)
    }
  }

  function toggleAiSubtask(i: number) {
    setAiSuggest(prev => {
      if (!prev || prev.phase !== 'done') return prev
      const subtasks = prev.subtasks.map((s, idx) =>
        idx === i ? { ...s, checked: !s.checked } : s
      )
      return { ...prev, subtasks }
    })
  }

  function commitWithAI() {
    const title = (aiSuggest?.phase === 'done' && aiSuggest.newTitle)
      ? aiSuggest.newTitle
      : newTaskTitle.trim()
    if (!title) return
    const newId = addTask(title, project.id)
    if (aiSuggest?.phase === 'done') {
      for (const sub of aiSuggest.subtasks.filter(s => s.checked)) {
        addSubtask(project.id, newId, sub.title)
      }
    }
    setNewTaskTitle('')
    setAiSuggest(null)
  }

  const DONE_VISIBLE = 5

  const categoryConfig = CATEGORY_CONFIG[project.category]
  const doneTasks = useMemo(
    () => [...project.tasks.filter(t => t.status === 'done')]
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [project.tasks]
  )
  const activeTasks = project.tasks.filter(t => t.status !== 'done')
  const totalTasks = project.tasks.length

  const activeIds = useMemo(() => activeTasks.map(t => t.id), [activeTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    if (aiSuggest?.phase === 'done') {
      commitWithAI()
    } else {
      addTask(newTaskTitle.trim(), project.id)
      setNewTaskTitle('')
      setAiSuggest(null)
    }
  }

  function handleToggleTask(taskId: string) {
    const task = project.tasks.find(t => t.id === taskId)
    if (!task) return

    const newDone = task.status !== 'done'
    updateTask(taskId, project.id, {
      status: newDone ? 'done' : 'backlog',
      completedAt: newDone ? new Date().toISOString() : undefined,
    })

    if (newDone && project.trackProgress) {
      recordDayWorked(project.id)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = activeIds.indexOf(active.id as string)
    const newIndex = activeIds.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(activeTasks, oldIndex, newIndex)
    // Persist: active tasks in new order + done tasks at end
    reorderProjectTasks(project.id, [...reordered.map(t => t.id), ...doneTasks.map(t => t.id)])
  }

  return (
    <div className="mt-1 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium">
            Tasks
          </span>
          {activeTasks.length > 0 && (
            <button
              onClick={() => setBulkPanelOpen(true)}
              title="Maak alle actieve taken actionable (AI)"
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.06em]
                text-stone/60 hover:text-amber-700 px-1.5 py-0.5 rounded border border-transparent
                hover:border-amber-200 hover:bg-amber-50/60 transition-all"
            >
              <Sparkles size={11} />
              Maak {activeTasks.length} actionable
            </button>
          )}
        </div>
        {totalTasks > 0 && (
          <span className="text-[11px] text-stone">
            {doneTasks.length} of {totalTasks} done
          </span>
        )}
      </div>

      {/* Add task form — Tab triggers AI subtask generation */}
      <form onSubmit={handleAddTask} className="mb-1 flex items-center gap-3">
        <Plus size={14} className="text-stone/30 flex-shrink-0" />
        <input
          type="text"
          value={newTaskTitle}
          onChange={e => { setNewTaskTitle(e.target.value); if (!e.target.value.trim()) setAiSuggest(null) }}
          onKeyDown={e => {
            if (e.key === 'Escape') { setAiSuggest(null) }
            if (e.key === 'Tab' && newTaskTitle.trim()) {
              e.preventDefault()
              triggerAISubtasks()
            }
          }}
          placeholder="Taak toevoegen... (Tab voor AI-subtaken)"
          className="flex-1 text-[13px] text-charcoal placeholder:text-stone/30
            bg-transparent border-none outline-none py-1.5"
        />
        {newTaskTitle.trim() && (
          <button
            type="button"
            onClick={triggerAISubtasks}
            disabled={aiSuggest?.phase === 'loading'}
            title="AI: splits in subtaken (Tab)"
            className={`flex-shrink-0 transition-colors
              ${aiSuggest?.phase === 'loading'
                ? 'text-amber-400 cursor-wait'
                : 'text-stone/25 hover:text-amber-600'}`}
          >
            <Sparkles size={13} />
          </button>
        )}
      </form>

      {/* AI subtask suggestion inline preview */}
      {aiSuggest && (
        <div className="ml-[26px] mb-3 rounded-[8px] border border-amber-200 bg-amber-50/40 p-2.5">
          {aiSuggest.phase === 'loading' ? (
            <div className="flex items-center gap-1.5 text-[11px] text-stone/50 py-0.5">
              <RefreshCw size={10} className="animate-spin text-amber-500" />
              AI genereert subtaken...
            </div>
          ) : (
            <>
              {aiSuggest.newTitle && aiSuggest.newTitle !== newTaskTitle && (
                <div className="text-[11px] text-stone/50 mb-2 flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">→</span>
                  <span className="italic">{aiSuggest.newTitle}</span>
                </div>
              )}
              <div className="space-y-1 mb-2.5">
                {aiSuggest.subtasks.map((s, i) => (
                  <label
                    key={i}
                    className="flex items-start gap-2 cursor-pointer group/ai"
                  >
                    <button
                      type="button"
                      onClick={() => toggleAiSubtask(i)}
                      className={`mt-0.5 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center flex-shrink-0 transition-colors
                        ${s.checked ? 'bg-amber-500 border-amber-500' : 'border-stone/30 hover:border-stone/50'}`}
                    >
                      {s.checked && <Check size={9} className="text-white" />}
                    </button>
                    <span className={`text-[12px] transition-colors ${s.checked ? 'text-charcoal/80' : 'text-stone/40 line-through'}`}>
                      {s.title}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={commitWithAI}
                  disabled={!aiSuggest.subtasks.some(s => s.checked)}
                  className="text-[11px] font-medium text-charcoal hover:text-charcoal/70 transition-colors
                    disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Voeg {aiSuggest.subtasks.filter(s => s.checked).length} subtaken toe ↵
                </button>
                <button
                  type="button"
                  onClick={() => { addTask(newTaskTitle.trim(), project.id); setNewTaskTitle(''); setAiSuggest(null) }}
                  className="text-[11px] text-stone/50 hover:text-stone/70 transition-colors"
                >
                  Zonder subtaken
                </button>
                <button
                  type="button"
                  onClick={() => setAiSuggest(null)}
                  className="ml-auto text-stone/30 hover:text-stone/60 transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {project.tasks.length === 0 && (
        <div className="text-[13px] text-stone/40 py-2 mb-2">
          Use checkboxes in the editor above, or add tasks here
        </div>
      )}

      {/* Active tasks — sortable */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={activeIds} strategy={verticalListSortingStrategy}>
          {activeTasks.map(task => (
            <SortableTaskRow
              key={task.id}
              task={task}
              color={categoryConfig.color}
              projectId={project.id}
              onToggle={() => handleToggleTask(task.id)}
              onDelete={() => deleteTask(task.id, project.id)}
              onRename={(title) => updateTask(task.id, project.id, { title })}
              onMakeActionable={() => setActionableTaskId(task.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Done tasks — most recent 5 visible, rest collapsible */}
      {doneTasks.length > 0 && (
        <>
          {activeTasks.length > 0 && <div className="border-t border-[#F0EEEB] mt-1.5 pt-1.5" />}
          {doneTasks.slice(0, showAllDone ? doneTasks.length : DONE_VISIBLE).map(task => (
            <DoneTaskRow
              key={task.id}
              task={task}
              color={categoryConfig.color}
              projectId={project.id}
              onToggle={() => handleToggleTask(task.id)}
              onDelete={() => deleteTask(task.id, project.id)}
              onRename={(title) => updateTask(task.id, project.id, { title })}
            />
          ))}
          {doneTasks.length > DONE_VISIBLE && (
            <button
              onClick={() => setShowAllDone(v => !v)}
              className="mt-1 text-[11px] text-stone/40 hover:text-stone/60 transition-colors"
            >
              {showAllDone
                ? 'Show less'
                : `+ ${doneTasks.length - DONE_VISIBLE} more done`}
            </button>
          )}
        </>
      )}

      {/* AI Make-Actionable panels */}
      {actionableTaskId && (() => {
        const t = project.tasks.find(t => t.id === actionableTaskId)
        if (!t) return null
        return (
          <MakeActionablePanel
            task={t}
            project={project}
            onClose={() => setActionableTaskId(null)}
          />
        )
      })()}
      {bulkPanelOpen && (
        <MakeActionableBulkPanel
          project={project}
          onClose={() => setBulkPanelOpen(false)}
        />
      )}
    </div>
  )
}
