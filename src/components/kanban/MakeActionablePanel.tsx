import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Check, X, RefreshCw, Edit2, Copy, MessageSquare, Mail, Phone, Globe } from 'lucide-react'
import { auth } from '../../lib/firebase'
import { useStore } from '../../store'
import { writeAIFeedback, loadRecentAIFeedback } from '../../lib/aiFeedback'
import { extractBlockNoteText } from '../../lib/utils'
import { DEFAULT_USER_TOOLS } from '../../types'
import type { Project, Task } from '../../types'

interface MakeActionablePanelProps {
  task: Task
  project: Project
  onClose: () => void
}

type Result =
  | { taskId: string; type: 'concrete'; newTitle: string; channel?: string; draftMessage?: string; reasoning?: string }
  | { taskId: string; type: 'subtasks'; newTitle?: string; subtasks: Array<{ title: string }>; reasoning?: string }
  | { taskId: string; type: 'alternatives'; alternatives: Array<{ title: string; channel?: string; draftMessage?: string }>; reasoning?: string }

export function MakeActionablePanel({ task, project, onClose }: MakeActionablePanelProps) {
  const updateTask = useStore(s => s.updateTask)
  const addSubtask = useStore(s => s.addSubtask)
  const deleteSubtask = useStore(s => s.deleteSubtask)
  const userTools = useStore(s => s.settings.userTools ?? DEFAULT_USER_TOOLS)
  const allProjects = useStore(s => s.projects)
  const contexts = useStore(s => s.settings.contexts ?? [])

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
  const [result, setResult] = useState<Result | null>(null)

  // For editing the suggestion before accepting
  const [editTitle, setEditTitle] = useState<string>('')
  const [editChannel, setEditChannel] = useState<string>('')
  const [editDraft, setEditDraft] = useState<string>('')
  const [editingMode, setEditingMode] = useState<boolean>(false)
  const [pickedAlt, setPickedAlt] = useState<number | null>(null)

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
            tasks: [{
              id: task.id,
              title: task.title,
              subtasks: task.subtasks?.map(s => ({ title: s.title, done: s.done })),
            }],
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
        const r = data.results?.[0]
        if (!r) {
          setError('Geen voorstel terug van AI')
          setLoading(false)
          return
        }
        setResult(r)
        // Pre-fill edit state
        if (r.type === 'concrete') {
          setEditTitle(r.newTitle ?? task.title)
          setEditChannel(r.channel ?? '')
          setEditDraft(r.draftMessage ?? '')
        } else if (r.type === 'subtasks') {
          setEditTitle(r.newTitle ?? task.title)
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error('make-actionable fetch failed', err)
        setError('Kon AI niet bereiken')
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [task.id, task.title, task.subtasks, project.title, project.waitingOn, userTools])

  function applyConcrete(opts: { title: string; channel: string; draft: string; edited: boolean }) {
    updateTask(task.id, project.id, {
      title: opts.title,
      actionableChannel: opts.channel || undefined,
      actionableDraft: opts.draft || undefined,
    })
    const uid = auth.currentUser?.uid
    if (uid && result?.type === 'concrete') {
      writeAIFeedback(uid, {
        taskId: task.id,
        projectId: project.id,
        original: task.title,
        suggested: result.newTitle,
        channel: result.channel,
        outcome: opts.edited ? 'edited' : 'accepted',
        userVersion: opts.edited ? opts.title : undefined,
      })
    }
    onClose()
  }

  function applySubtasks(parentTitle: string, subtasks: Array<{ title: string }>) {
    if (parentTitle && parentTitle !== task.title) {
      updateTask(task.id, project.id, { title: parentTitle })
    }
    // Replace existing open subtasks with new ones
    for (const existing of (task.subtasks ?? []).filter(s => !s.done)) {
      deleteSubtask(project.id, task.id, existing.id)
    }
    for (const sub of subtasks) {
      addSubtask(project.id, task.id, sub.title)
    }
    const uid = auth.currentUser?.uid
    if (uid && result?.type === 'subtasks') {
      writeAIFeedback(uid, {
        taskId: task.id,
        projectId: project.id,
        original: task.title,
        suggested: result.subtasks[0]?.title ?? '',
        outcome: 'accepted',
      })
    }
    onClose()
  }

  function handleReject() {
    const uid = auth.currentUser?.uid
    if (uid && result) {
      const suggested =
        result.type === 'concrete' ? result.newTitle :
        result.type === 'subtasks' ? (result.subtasks[0]?.title ?? '') :
        (result.alternatives[0]?.title ?? '')
      writeAIFeedback(uid, {
        taskId: task.id,
        projectId: project.id,
        original: task.title,
        suggested,
        outcome: 'rejected',
      })
    }
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-[12px] shadow-2xl border border-border w-[480px] max-w-[92vw]
          max-h-[85vh] overflow-y-auto animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-amber-500 flex-shrink-0" />
            <span className="text-[12px] uppercase tracking-[0.08em] text-stone font-medium">
              Maak actionable
            </span>
          </div>
          <button onClick={onClose} className="text-stone/50 hover:text-stone p-1">
            <X size={16} />
          </button>
        </div>

        {/* Original task */}
        <div className="px-5 py-3 border-b border-border bg-canvas/40">
          <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50 mb-1">Originele taak</div>
          <div className="text-[13px] text-charcoal/80 italic">"{task.title}"</div>
        </div>

        {/* Body */}
        <div className="p-5">
          {loading && <LoadingState />}
          {error && <ErrorState error={error} onClose={onClose} />}
          {!loading && !error && result?.type === 'concrete' && (
            <ConcreteView
              editTitle={editTitle} setEditTitle={setEditTitle}
              editChannel={editChannel} setEditChannel={setEditChannel}
              editDraft={editDraft} setEditDraft={setEditDraft}
              editingMode={editingMode} setEditingMode={setEditingMode}
              reasoning={result.reasoning}
              originalSuggested={result.newTitle}
              onAccept={() => applyConcrete({
                title: editTitle,
                channel: editChannel,
                draft: editDraft,
                edited: editTitle !== result.newTitle || editChannel !== (result.channel ?? '') || editDraft !== (result.draftMessage ?? ''),
              })}
              onReject={handleReject}
            />
          )}
          {!loading && !error && result?.type === 'subtasks' && (
            <SubtasksView
              parentTitle={editTitle}
              setParentTitle={setEditTitle}
              subtasks={result.subtasks}
              reasoning={result.reasoning}
              onAccept={() => applySubtasks(editTitle, result.subtasks)}
              onReject={handleReject}
            />
          )}
          {!loading && !error && result?.type === 'alternatives' && (
            <AlternativesView
              alternatives={result.alternatives}
              picked={pickedAlt}
              onPick={i => {
                setPickedAlt(i)
                const alt = result.alternatives[i]
                setEditTitle(alt.title)
                setEditChannel(alt.channel ?? '')
                setEditDraft(alt.draftMessage ?? '')
              }}
              reasoning={result.reasoning}
              chosen={pickedAlt !== null ? {
                title: editTitle, channel: editChannel, draft: editDraft,
              } : null}
              setChosen={({ title, channel, draft }) => {
                setEditTitle(title)
                setEditChannel(channel)
                setEditDraft(draft)
              }}
              onAccept={() => {
                if (pickedAlt === null) return
                applyConcrete({
                  title: editTitle,
                  channel: editChannel,
                  draft: editDraft,
                  edited: true, // alternatives implies user picked one
                })
              }}
              onReject={handleReject}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Subviews ───────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="py-8 flex flex-col items-center gap-2 text-stone/60">
      <RefreshCw size={18} className="animate-spin" />
      <span className="text-[12px]">AI denkt na...</span>
    </div>
  )
}

function ErrorState({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="py-6 text-center">
      <div className="text-[13px] text-red-600 mb-3">{error}</div>
      <button onClick={onClose} className="text-[12px] text-stone/60 hover:text-stone">
        Sluiten
      </button>
    </div>
  )
}

function ChannelChip({ channel }: { channel: string }) {
  const iconMap: Record<string, typeof MessageSquare> = {
    Slack: MessageSquare,
    Gmail: Mail,
    Email: Mail,
    phone: Phone,
    Phone: Phone,
    Telefoon: Phone,
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

interface ConcreteViewProps {
  editTitle: string; setEditTitle: (v: string) => void
  editChannel: string; setEditChannel: (v: string) => void
  editDraft: string; setEditDraft: (v: string) => void
  editingMode: boolean; setEditingMode: (v: boolean) => void
  reasoning?: string
  originalSuggested: string
  onAccept: () => void
  onReject: () => void
}

function ConcreteView({
  editTitle, setEditTitle, editChannel, setEditChannel, editDraft, setEditDraft,
  editingMode, setEditingMode, reasoning, onAccept, onReject,
}: ConcreteViewProps) {
  function copyDraft() {
    if (editDraft) navigator.clipboard?.writeText(editDraft).catch(() => {})
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50 mb-1.5">
          Concrete next-action
        </div>
        {editingMode ? (
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            className="w-full px-3 py-2 text-[14px] text-charcoal border border-stone/40 rounded-[6px]
              bg-canvas outline-none focus:border-stone/60"
            autoFocus
          />
        ) : (
          <div className="text-[14px] text-charcoal font-medium leading-snug">{editTitle}</div>
        )}
      </div>

      {(editChannel || editingMode) && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50 mb-1.5">Channel</div>
          {editingMode ? (
            <input
              value={editChannel}
              onChange={e => setEditChannel(e.target.value)}
              placeholder="Slack / Gmail / phone / Boat Local admin / ..."
              className="w-full px-3 py-1.5 text-[12px] text-charcoal border border-stone/40 rounded-[6px]
                bg-canvas outline-none focus:border-stone/60"
            />
          ) : editChannel ? (
            <ChannelChip channel={editChannel} />
          ) : null}
        </div>
      )}

      {(editDraft || editingMode) && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] text-stone/50">Concept-bericht</span>
            {!editingMode && editDraft && (
              <button
                onClick={copyDraft}
                className="text-[10px] text-stone/60 hover:text-charcoal flex items-center gap-1"
              >
                <Copy size={11} /> Kopieer
              </button>
            )}
          </div>
          {editingMode ? (
            <textarea
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              placeholder="Optioneel concept om te kopiëren..."
              rows={4}
              className="w-full px-3 py-2 text-[12px] text-charcoal border border-stone/40 rounded-[6px]
                bg-canvas outline-none focus:border-stone/60 resize-y"
            />
          ) : editDraft ? (
            <div className="text-[12px] text-charcoal/80 whitespace-pre-wrap bg-canvas/60 border border-border
              rounded-[6px] p-3 leading-relaxed">
              {editDraft}
            </div>
          ) : null}
        </div>
      )}

      {reasoning && !editingMode && (
        <div className="text-[10px] text-stone/40 italic leading-relaxed">{reasoning}</div>
      )}

      <ActionButtons
        onAccept={onAccept}
        onReject={onReject}
        editingMode={editingMode}
        toggleEdit={() => setEditingMode(!editingMode)}
      />
    </div>
  )
}

function SubtasksView({
  parentTitle, setParentTitle, subtasks, reasoning, onAccept, onReject,
}: {
  parentTitle: string
  setParentTitle: (v: string) => void
  subtasks: Array<{ title: string }>
  reasoning?: string
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50 mb-1.5">
          Hoofdtaak (titel blijft of wordt aangepast)
        </div>
        <input
          value={parentTitle}
          onChange={e => setParentTitle(e.target.value)}
          className="w-full px-3 py-2 text-[14px] text-charcoal border border-stone/30 rounded-[6px]
            bg-canvas outline-none focus:border-stone/60"
        />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50 mb-1.5">
          Te splitsen in subtaken ({subtasks.length})
        </div>
        <ul className="space-y-1.5">
          {subtasks.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-[13px] text-charcoal">
              <span className="w-4 h-4 rounded-[3px] border border-stone/30 flex-shrink-0" />
              {s.title}
            </li>
          ))}
        </ul>
      </div>

      {reasoning && (
        <div className="text-[10px] text-stone/40 italic leading-relaxed">{reasoning}</div>
      )}

      <ActionButtons onAccept={onAccept} onReject={onReject} hideEdit />
    </div>
  )
}

function AlternativesView({
  alternatives, picked, onPick, reasoning, chosen, setChosen, onAccept, onReject,
}: {
  alternatives: Array<{ title: string; channel?: string; draftMessage?: string }>
  picked: number | null
  onPick: (i: number) => void
  reasoning?: string
  chosen: { title: string; channel: string; draft: string } | null
  setChosen: (v: { title: string; channel: string; draft: string }) => void
  onAccept: () => void
  onReject: () => void
}) {
  if (picked === null) {
    return (
      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-[0.08em] text-stone/50">
          Kies een richting
        </div>
        <div className="space-y-2">
          {alternatives.map((a, i) => (
            <button
              key={i}
              onClick={() => onPick(i)}
              className="w-full text-left px-3 py-2.5 rounded-[8px] border border-border
                hover:border-stone/40 hover:bg-canvas/50 transition-colors"
            >
              <div className="text-[13px] text-charcoal font-medium mb-1">{a.title}</div>
              {a.channel && <ChannelChip channel={a.channel} />}
            </button>
          ))}
        </div>
        {reasoning && (
          <div className="text-[10px] text-stone/40 italic leading-relaxed">{reasoning}</div>
        )}
        <div className="pt-2 flex justify-end">
          <button onClick={onReject} className="text-[12px] text-stone/60 hover:text-stone">
            Geen van deze
          </button>
        </div>
      </div>
    )
  }
  // Picked one → show editable concrete view
  return (
    <ConcreteView
      editTitle={chosen?.title ?? ''}
      setEditTitle={v => setChosen({ title: v, channel: chosen?.channel ?? '', draft: chosen?.draft ?? '' })}
      editChannel={chosen?.channel ?? ''}
      setEditChannel={v => setChosen({ title: chosen?.title ?? '', channel: v, draft: chosen?.draft ?? '' })}
      editDraft={chosen?.draft ?? ''}
      setEditDraft={v => setChosen({ title: chosen?.title ?? '', channel: chosen?.channel ?? '', draft: v })}
      editingMode={false}
      setEditingMode={() => {}}
      reasoning={undefined}
      originalSuggested={alternatives[picked]?.title ?? ''}
      onAccept={onAccept}
      onReject={onReject}
    />
  )
}

function ActionButtons({
  onAccept, onReject, editingMode, toggleEdit, hideEdit,
}: {
  onAccept: () => void
  onReject: () => void
  editingMode?: boolean
  toggleEdit?: () => void
  hideEdit?: boolean
}) {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border/60">
      <button
        onClick={onAccept}
        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[6px]
          bg-charcoal text-canvas text-[13px] font-medium hover:bg-charcoal/90 transition-colors"
      >
        <Check size={13} /> Accepteer
      </button>
      {!hideEdit && (
        <button
          onClick={toggleEdit}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[6px]
            border border-border text-[13px] text-stone hover:text-charcoal hover:border-stone/30 transition-colors"
        >
          <Edit2 size={13} /> {editingMode ? 'Klaar' : 'Bewerk'}
        </button>
      )}
      <button
        onClick={onReject}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[6px]
          text-[13px] text-stone/60 hover:text-stone hover:bg-border-light/60 transition-colors"
      >
        Verwerp
      </button>
    </div>
  )
}
