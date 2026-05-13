import { useState } from 'react'
import { X, Check, Clock, CheckCircle2 } from 'lucide-react'
import { normalizeWaitingOn } from '../../lib/utils'
import { WaitingBadge } from '../ui/WaitingBadge'
import { WaitingOnForm } from '../ui/WaitingOnForm'
import type { Project, WaitingOn } from '../../types'

interface ProjectModalWaitingProps {
  project: Project
  updateProject: (id: string, updates: Partial<Project>) => void
}

export function ProjectModalWaiting({ project, updateProject }: ProjectModalWaitingProps) {
  const [editingWaiting, setEditingWaiting] = useState(false)
  const [waitingPerson, setWaitingPerson] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const waitingEntries = normalizeWaitingOn(project.waitingOn)

  function handleAddWaiting() {
    if (!waitingPerson.trim()) return
    const newEntry: WaitingOn = { person: waitingPerson.trim(), since: new Date().toISOString() }
    // Never auto-change status — just add the entry
    updateProject(project.id, {
      waitingOn: [...waitingEntries, newEntry],
    })
    setEditingWaiting(false)
    setWaitingPerson('')
  }

  function handleRemoveWaiting(index: number) {
    const updated = waitingEntries.filter((_, i) => i !== index)
    updateProject(project.id, {
      waitingOn: updated.length > 0 ? updated : undefined,
    })
  }

  function handleStartEdit(index: number) {
    setEditingIndex(index)
    setEditingValue(waitingEntries[index].person)
  }

  function handleSaveEdit() {
    if (editingIndex === null || !editingValue.trim()) return
    const updated = waitingEntries.map((e, i) =>
      i === editingIndex ? { ...e, person: editingValue.trim() } : e
    )
    updateProject(project.id, { waitingOn: updated })
    setEditingIndex(null)
    setEditingValue('')
  }

  function handleCancelEdit() {
    setEditingIndex(null)
    setEditingValue('')
  }

  return (
    <>
      {/* Waiting entries — always visible when they exist */}
      {waitingEntries.length > 0 && (
        <div className="py-3 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={11} className="text-stone/50" />
            <span className="text-[11px] uppercase tracking-[0.08em] text-stone/70 font-medium">
              Waiting on
            </span>
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
              {waitingEntries.length}
            </span>
          </div>
          <div className="space-y-2 pl-0.5">
            {waitingEntries.map((entry, index) => {
              if (editingIndex === index) {
                return (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={editingValue}
                      onChange={e => setEditingValue(e.target.value)}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveEdit()
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      className="flex-1 px-2 py-1 rounded-[4px] border border-stone/40 bg-card
                        text-[13px] text-charcoal outline-none focus:border-stone/60 transition-colors"
                    />
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editingValue.trim()}
                      className="text-stone hover:text-charcoal transition-colors disabled:opacity-30 p-0.5"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="text-stone hover:text-charcoal transition-colors p-0.5"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              }
              return (
                <div key={index} className="flex items-center justify-between group">
                  <button
                    onClick={() => handleStartEdit(index)}
                    className="text-[13px] text-charcoal hover:text-stone transition-colors text-left"
                  >
                    {entry.person}
                  </button>
                  <div className="flex items-center gap-2">
                    <WaitingBadge since={entry.since} shape="rounded-full" />
                    <button
                      onClick={() => handleRemoveWaiting(index)}
                      title="Got it — they delivered"
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                        text-stone hover:!text-emerald-600 transition-all p-0.5"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                    <button
                      onClick={() => handleRemoveWaiting(index)}
                      title="Remove"
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100
                        text-stone hover:!text-red-600 transition-all p-0.5"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {editingWaiting && (
            <div className="mt-3">
              <WaitingOnForm
                value={waitingPerson}
                onChange={setWaitingPerson}
                onConfirm={handleAddWaiting}
                onCancel={() => { setEditingWaiting(false); setWaitingPerson('') }}
              />
            </div>
          )}

          {!editingWaiting && (
            <button
              onClick={() => setEditingWaiting(true)}
              className="mt-2 text-[12px] text-stone/50 hover:text-stone transition-colors"
            >
              + Add another
            </button>
          )}
        </div>
      )}

      {/* Add first waiting entry — available for any status */}
      {waitingEntries.length === 0 && (
        <>
          {editingWaiting ? (
            <div className="py-3 border-t border-border">
              <WaitingOnForm
                value={waitingPerson}
                onChange={setWaitingPerson}
                onConfirm={handleAddWaiting}
                onCancel={() => { setEditingWaiting(false); setWaitingPerson('') }}
              />
            </div>
          ) : (
            <button
              onClick={() => setEditingWaiting(true)}
              className="text-[12px] text-stone hover:text-charcoal py-3 border-t border-border w-full text-left transition-colors"
            >
              Waiting on someone?
            </button>
          )}
        </>
      )}
    </>
  )
}
