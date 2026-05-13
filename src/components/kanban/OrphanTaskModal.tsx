import { useState, useCallback, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { useStore } from '../../store'
import { ProjectEditor } from '../editor/ProjectEditor'
import type { Task, WaitingOn } from '../../types'
import { WaitingBadge } from '../ui/WaitingBadge'
import { WaitingOnForm } from '../ui/WaitingOnForm'

interface OrphanTaskModalProps {
  task: Task
  onClose: () => void
}

export function OrphanTaskModal({ task, onClose }: OrphanTaskModalProps) {
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const deleteOrphanTask = useStore(s => s.deleteOrphanTask)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showEditor, setShowEditor] = useState(false)

  // Waiting-on state
  const [editingWaiting, setEditingWaiting] = useState(false)
  const [waitingPerson, setWaitingPerson] = useState('')
  const [editingWaitingIndex, setEditingWaitingIndex] = useState<number | null>(null)
  const [editingWaitingValue, setEditingWaitingValue] = useState('')

  const waitingEntries: WaitingOn[] = task.waitingOn ?? []
  // Derive the effective kanban column for this task
  const effectiveCol = task.kanbanColumn ?? (task.status === 'vandaag' ? 'in_progress' : 'backlog')
  const isTaskInProgress = effectiveCol === 'in_progress'
  const isTaskInWaiting = effectiveCol === 'waiting'

  function handleAddWaiting() {
    if (!waitingPerson.trim()) return
    const newEntry: WaitingOn = { person: waitingPerson.trim(), since: new Date().toISOString() }
    updateOrphanTask(task.id, {
      waitingOn: [...waitingEntries, newEntry],
      ...(isTaskInProgress ? { kanbanColumn: 'waiting' } : {}),
    })
    setWaitingPerson('')
    setEditingWaiting(false)
  }

  function handleRemoveWaiting(index: number) {
    const updated = waitingEntries.filter((_, i) => i !== index)
    if (updated.length === 0) {
      updateOrphanTask(task.id, {
        waitingOn: undefined,
        ...(isTaskInWaiting ? { kanbanColumn: 'in_progress' } : {}),
      })
    } else {
      updateOrphanTask(task.id, { waitingOn: updated })
    }
  }

  function handleSaveWaitingEdit() {
    if (editingWaitingIndex === null || !editingWaitingValue.trim()) return
    const updated = waitingEntries.map((e, i) =>
      i === editingWaitingIndex ? { ...e, person: editingWaitingValue.trim() } : e
    )
    updateOrphanTask(task.id, { waitingOn: updated })
    setEditingWaitingIndex(null)
    setEditingWaitingValue('')
  }

  // Delay showing editor to avoid flash
  useEffect(() => {
    const timer = setTimeout(() => setShowEditor(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleEditorChange = useCallback((content: string) => {
    updateOrphanTask(task.id, { bodyContent: content })
  }, [task.id, updateOrphanTask])

  function handleTitleSubmit() {
    if (titleDraft.trim()) {
      updateOrphanTask(task.id, { title: titleDraft.trim() })
    }
    setEditingTitle(false)
  }

  function handleDelete() {
    deleteOrphanTask(task.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" />
      <div
        className="relative bg-card w-full rounded-t-[16px] sm:rounded-[10px] sm:max-w-xl sm:max-h-[85vh] max-h-[90vh] overflow-y-auto animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-7 h-7 flex items-center justify-center
            rounded-full bg-canvas/80 text-stone hover:text-charcoal transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="px-7 pt-7 pb-6">
          {/* Task label */}
          <div className="text-[10px] uppercase tracking-[0.08em] text-stone/40 font-medium mb-2">
            Task
          </div>

          {/* Title */}
          {editingTitle ? (
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTitleSubmit()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              autoFocus
              className="text-[22px] font-serif text-charcoal bg-transparent border-none outline-none w-full mb-5 tracking-[-0.01em]"
            />
          ) : (
            <h2
              className="text-[22px] font-serif text-charcoal mb-5 cursor-pointer hover:opacity-70 transition-opacity tracking-[-0.01em] pr-8"
              onClick={() => {
                setTitleDraft(task.title)
                setEditingTitle(true)
              }}
            >
              {task.title}
            </h2>
          )}

          {/* Rich text editor */}
          <div className="border-t border-border pt-4">
            <div className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-3">
              Notes
            </div>
            {showEditor && (
              <div className="min-h-[120px] -mx-3">
                <ProjectEditor
                  key={task.id}
                  initialContent={task.bodyContent ?? ''}
                  onChange={handleEditorChange}
                />
              </div>
            )}
          </div>

          {/* Waiting on */}
          <div className="mt-4 pt-4 border-t border-border">
            {waitingEntries.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-2">
                  Waiting on
                </div>
                <div className="space-y-2">
                  {waitingEntries.map((entry, index) => {
                    if (editingWaitingIndex === index) {
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            value={editingWaitingValue}
                            onChange={e => setEditingWaitingValue(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveWaitingEdit()
                              if (e.key === 'Escape') { setEditingWaitingIndex(null); setEditingWaitingValue('') }
                            }}
                            className="flex-1 px-2 py-1 rounded-[4px] border border-stone/40 bg-card
                              text-[13px] text-charcoal outline-none focus:border-stone/60 transition-colors"
                          />
                          <button onClick={handleSaveWaitingEdit} disabled={!editingWaitingValue.trim()}
                            className="text-stone hover:text-charcoal transition-colors disabled:opacity-30 p-0.5">
                            <Check size={14} />
                          </button>
                          <button onClick={() => { setEditingWaitingIndex(null); setEditingWaitingValue('') }}
                            className="text-stone hover:text-charcoal transition-colors p-0.5">
                            <X size={14} />
                          </button>
                        </div>
                      )
                    }
                    return (
                      <div key={index} className="flex items-center justify-between">
                        <button
                          onClick={() => { setEditingWaitingIndex(index); setEditingWaitingValue(entry.person) }}
                          className="text-[13px] text-charcoal hover:text-stone transition-colors text-left"
                        >
                          {entry.person}
                        </button>
                        <div className="flex items-center gap-2">
                          <WaitingBadge since={entry.since} shape="rounded-full" />
                          <button onClick={() => handleRemoveWaiting(index)}
                            className="text-stone hover:text-charcoal transition-colors p-0.5">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {!editingWaiting && (
              <button
                onClick={() => setEditingWaiting(true)}
                className="text-[12px] text-stone hover:text-charcoal transition-colors"
              >
                {waitingEntries.length > 0 ? 'Add another...' : 'Waiting on someone?'}
              </button>
            )}
            {editingWaiting && (
              <div className="mt-2">
                <WaitingOnForm
                  value={waitingPerson}
                  onChange={setWaitingPerson}
                  onConfirm={handleAddWaiting}
                  onCancel={() => { setEditingWaiting(false); setWaitingPerson('') }}
                />
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="mt-6 pt-4 border-t border-border">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-red">Delete this task?</span>
                <button
                  onClick={handleDelete}
                  className="text-[12px] text-card bg-red px-3 py-1.5 rounded-[6px] hover:opacity-90 transition-opacity"
                >
                  Delete
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-[12px] text-stone hover:text-charcoal transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-[12px] text-stone hover:text-red transition-colors"
              >
                Delete task...
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
