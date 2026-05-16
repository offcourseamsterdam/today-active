import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X, RefreshCw, Check, MessageSquare, Mail, Phone, Globe } from 'lucide-react'
import { auth } from '../../lib/firebase'
import { useStore } from '../../store'
import { writeAIFeedback, loadRecentAIFeedback } from '../../lib/aiFeedback'
import { extractBlockNoteText } from '../../lib/utils'
import { DEFAULT_USER_TOOLS } from '../../types'
import type { Project } from '../../types'

interface MakeActionableBulkPanelProps {
  project: Project
  onClose: () => void
}

type Result =
  | { taskId: string; type: 'concrete'; newTitle: string; channel?: string; draftMessage?: string; reasoning?: string }
  | { taskId: string; type: 'subtasks'; newTitle?: string; subtasks: Array<{ title: string }>; reasoning?: string }
  | { taskId: string; type: 'alternatives'; alternatives: Array<{ title: string; channel?: string; draftMessage?: string }>; reasoning?: string }

// edits map: taskId → overridden title / subtask titles
type EditMap = Record<string, { newTitle?: string; subtasks?: string[] }>

export function MakeActionableBulkPanel({ project, onClose }: MakeActionableBulkPanelProps) {
  const updateTask = useStore(s => s.updateTask)
  const addSubtask = useStore(s => s.addSubtask)
  const userTools = useStore(s => s.settings.userTools ?? DEFAULT_USER_TOOLS)
  const allProjects = useStore(s => s.projects)
  const contexts = useStore(s => s.settings.contexts ?? [])

  const activeTasks = project.tasks.filter(t => t.status !== 'done' && t.status !== 'dropped')

  // Resolve work-context names and related projects
  const contextNames = (project.contextIds ?? [])
    .map(id => contexts.find(c => c.id === id)?.name)
    .filter(Boolean) as string[]

  const relatedProjects = contextNames.length > 0
    ? allProjects
        .filter(p => p.id !== project.id && p.status !== 'done' &&
          p.contextIds?.some(cid => project.contextIds?.includes(cid)))
        .map(p => ({
          title: p.title,
          category: p.category,
          status: p.status,
          activeTasks: p.tasks
            .filter(t => t.status !== 'done' && t.status !== 'dropped')
            .slice(0, 5)
            .map(t => t.title),
        }))
        .slice(0, 10)
    : []

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<EditMap>({})

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const uid = auth.currentUser?.uid
        const recentFeedback = uid ? await loadRecentAIFeedback(uid, 15) : []

        const response = await fetch('/api/make-actionable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: activeTasks.map(t => ({
              id: t.id,
              title: t.title,
              subtasks: t.subtasks?.map(s => ({ title: s.title, done: s.done })),
            })),
            project: {
              title: project.title,
              category: project.category,
              notes: extractBlockNoteText(project.bodyContent, 1500),
              waitingOn: project.waitingOn,
            },
            contextName: contextNames.length > 0 ? contextNames.join(', ') : undefined,
            relatedProjects: relatedProjects.length > 0 ? relatedProjects : undefined,
            userTools,
            recentFeedback,
          }),
        })

        if (!response.ok) {
          if (response.status === 503) {
            setError('AI niet geconfigureerd — voeg OPENAI_API_KEY toe in Vercel env')
          } else if (response.status === 429) {
            setError('Even wachten, probeer over 30 sec opnieuw')
          } else {
            setError(`AI fout (${response.status})`)
          }
          setLoading(false)
          return
        }
        const data = await response.json() as { results: Result[] }
        if (cancelled) return
        const r = data.results ?? []
        setResults(r)
        // Pre-check everything
        setChecked(new Set(r.map(x => x.taskId)))
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error('bulk make-actionable failed', err)
        setError('Kon AI niet bereiken')
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [project.id])  // eslint-disable-line react-hooks/exhaustive-deps

  function toggleChecked(taskId: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function setEditTitle(taskId: string, title: string) {
    setEdits(prev => ({ ...prev, [taskId]: { ...prev[taskId], newTitle: title } }))
  }

  function setEditSubtask(taskId: string, index: number, title: string) {
    setEdits(prev => {
      const r = results.find(x => x.taskId === taskId)
      const origSubs = r?.type === 'subtasks' ? r.subtasks.map(s => s.title) : []
      const current = [...(prev[taskId]?.subtasks ?? origSubs)]
      current[index] = title
      return { ...prev, [taskId]: { ...prev[taskId], subtasks: current } }
    })
  }

  function handleApply() {
    const uid = auth.currentUser?.uid
    for (const r of results) {
      const task = activeTasks.find(t => t.id === r.taskId)
      if (!task) continue
      const isChecked = checked.has(r.taskId)
      if (!isChecked) {
        if (uid) {
          const suggested =
            r.type === 'concrete' ? r.newTitle :
            r.type === 'subtasks' ? (r.subtasks[0]?.title ?? '') :
            (r.alternatives[0]?.title ?? '')
          writeAIFeedback(uid, {
            taskId: task.id,
            projectId: project.id,
            original: task.title,
            suggested,
            outcome: 'rejected',
          })
        }
        continue
      }
      const edit = edits[r.taskId]

      if (r.type === 'concrete') {
        const effectiveTitle = edit?.newTitle ?? r.newTitle
        updateTask(task.id, project.id, {
          title: effectiveTitle,
          actionableChannel: r.channel || undefined,
          actionableDraft: r.draftMessage || undefined,
        })
        if (uid) {
          const edited = effectiveTitle !== r.newTitle
          writeAIFeedback(uid, {
            taskId: task.id,
            projectId: project.id,
            original: task.title,
            suggested: r.newTitle,
            channel: r.channel,
            outcome: edited ? 'edited' : 'accepted',
            userVersion: edited ? effectiveTitle : undefined,
          })
        }
      } else if (r.type === 'subtasks') {
        const effectiveTitle = edit?.newTitle ?? r.newTitle
        if (effectiveTitle && effectiveTitle !== task.title) {
          updateTask(task.id, project.id, { title: effectiveTitle })
        }
        const effectiveSubs = edit?.subtasks
          ? edit.subtasks.map(t => ({ title: t }))
          : r.subtasks
        for (const sub of effectiveSubs) {
          if (sub.title.trim()) addSubtask(project.id, task.id, sub.title.trim())
        }
        if (uid) {
          writeAIFeedback(uid, {
            taskId: task.id,
            projectId: project.id,
            original: task.title,
            suggested: r.subtasks[0]?.title ?? '',
            outcome: 'accepted',
          })
        }
      }
      // For 'alternatives': bulk apply doesn't pick a route — skip silently.
      // User must use the per-task button to pick from alternatives.
    }
    onClose()
  }

  const checkedCount = [...checked].filter(id => {
    const r = results.find(x => x.taskId === id)
    return r && r.type !== 'alternatives'
  }).length

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-[12px] shadow-2xl border border-border w-[640px] max-w-[94vw]
          max-h-[88vh] flex flex-col animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-amber-500 flex-shrink-0" />
            <span className="text-[12px] uppercase tracking-[0.08em] text-stone font-medium">
              Maak {activeTasks.length} taken actionable
            </span>
          </div>
          <button onClick={onClose} className="text-stone/50 hover:text-stone p-1">
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="py-12 flex flex-col items-center gap-2 text-stone/60">
              <RefreshCw size={20} className="animate-spin" />
              <span className="text-[12px]">AI verwerkt {activeTasks.length} taken...</span>
            </div>
          )}
          {error && (
            <div className="py-6 text-center">
              <div className="text-[13px] text-red-600 mb-3">{error}</div>
              <button onClick={onClose} className="text-[12px] text-stone/60 hover:text-stone">
                Sluiten
              </button>
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="py-6 text-center text-[13px] text-stone/60">
              Geen voorstellen ontvangen.
            </div>
          )}
          {!loading && !error && results.length > 0 && (
            <ul className="space-y-3">
              {results.map(r => {
                const task = activeTasks.find(t => t.id === r.taskId)
                if (!task) return null
                const isChecked = checked.has(r.taskId)
                const isAlt = r.type === 'alternatives'
                return (
                  <li
                    key={r.taskId}
                    className={`rounded-[8px] border p-3 transition-colors
                      ${isAlt
                        ? 'border-amber-200 bg-amber-50/40'
                        : isChecked
                          ? 'border-stone/30 bg-canvas/50'
                          : 'border-border bg-card opacity-60'}`}
                  >
                    <div className="flex items-start gap-3">
                      {!isAlt && (
                        <button
                          onClick={() => toggleChecked(r.taskId)}
                          className={`mt-0.5 w-4 h-4 rounded-[3px] border flex items-center justify-center flex-shrink-0
                            ${isChecked ? 'bg-charcoal border-charcoal' : 'border-stone/40 hover:border-stone/60'}`}
                        >
                          {isChecked && <Check size={11} className="text-canvas" />}
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-stone/50 mb-1 line-through truncate">
                          {task.title}
                        </div>
                        <BulkResultPreview
                          result={r}
                          editMap={edits[r.taskId]}
                          onEditTitle={title => setEditTitle(r.taskId, title)}
                          onEditSubtask={(i, title) => setEditSubtask(r.taskId, i, title)}
                        />
                        {r.reasoning && (
                          <div className="mt-1.5 text-[10px] text-stone/40 italic">{r.reasoning}</div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && results.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] text-stone/60">
              {checkedCount} aangevinkt · {results.filter(r => r.type === 'alternatives').length} alternatieven (per-taak)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-[12px] text-stone hover:text-charcoal rounded-[6px]
                  border border-border hover:border-stone/30 transition-colors"
              >
                Annuleer
              </button>
              <button
                onClick={handleApply}
                disabled={checkedCount === 0}
                className="px-4 py-2 text-[12px] font-medium rounded-[6px]
                  bg-charcoal text-canvas hover:bg-charcoal/90 transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Pas toe op {checkedCount} {checkedCount === 1 ? 'taak' : 'taken'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Result preview cards (inline-editable) ────────────────────

function ChannelChip({ channel }: { channel: string }) {
  const iconMap: Record<string, typeof MessageSquare> = {
    Slack: MessageSquare, Gmail: Mail, Email: Mail,
    phone: Phone, Phone: Phone, Telefoon: Phone,
  }
  const Icon = iconMap[channel] ?? Globe
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
      bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
      <Icon size={10} />
      {channel}
    </span>
  )
}

interface EditMap { newTitle?: string; subtasks?: string[] }

function InlineField({
  value,
  onChange,
  className = '',
}: { value: string; onChange: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  function commit() {
    const v = draft.trim()
    if (v) onChange(v)
    else setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`bg-transparent border-b border-stone/30 outline-none focus:border-stone/60 ${className}`}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Klik om te bewerken"
      className={`cursor-text rounded-[2px] hover:bg-stone/8 transition-colors ${className}`}
    >
      {value}
    </span>
  )
}

function BulkResultPreview({
  result,
  editMap,
  onEditTitle,
  onEditSubtask,
}: {
  result: Result
  editMap: EditMap | undefined
  onEditTitle: (title: string) => void
  onEditSubtask: (i: number, title: string) => void
}) {
  if (result.type === 'concrete') {
    const title = editMap?.newTitle ?? result.newTitle
    return (
      <div className="space-y-1.5">
        <InlineField
          value={title}
          onChange={onEditTitle}
          className="text-[13px] text-charcoal font-medium w-full"
        />
        {result.channel && <ChannelChip channel={result.channel} />}
      </div>
    )
  }
  if (result.type === 'subtasks') {
    const parentTitle = editMap?.newTitle ?? result.newTitle
    const subtaskTitles = editMap?.subtasks ?? result.subtasks.map(s => s.title)
    return (
      <div className="space-y-1">
        {parentTitle && (
          <InlineField
            value={parentTitle}
            onChange={onEditTitle}
            className="text-[13px] text-charcoal font-medium w-full mb-1"
          />
        )}
        <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50">Subtaken</div>
        <ul className="space-y-0.5 ml-1">
          {subtaskTitles.map((title, i) => (
            <li key={i} className="text-[12px] text-charcoal/80 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-stone/40 flex-shrink-0" />
              <InlineField
                value={title}
                onChange={v => onEditSubtask(i, v)}
                className="flex-1"
              />
            </li>
          ))}
        </ul>
      </div>
    )
  }
  // alternatives — user must use per-task button
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-amber-700 font-medium">
        Alternatieven — gebruik per-taak knop om te kiezen
      </div>
      <ul className="space-y-0.5">
        {result.alternatives.map((a, i) => (
          <li key={i} className="text-[12px] text-charcoal/70">• {a.title}</li>
        ))}
      </ul>
    </div>
  )
}
