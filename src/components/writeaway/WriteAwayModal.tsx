import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Zap } from 'lucide-react'
import { useStore } from '../../store'

type Tag = 'urgent-work' | 'work' | 'personal'

interface WriteAwayModalProps {
  onClose: () => void
  /** When true, shows a post-submit confirmation instead of closing (for /dump route) */
  standalone?: boolean
}

const TAG_OPTIONS: { value: Tag; label: string; color: string }[] = [
  { value: 'urgent-work', label: 'Urgent werk', color: 'text-red-600' },
  { value: 'work',        label: 'Werk',         color: 'text-stone' },
  { value: 'personal',    label: 'Persoonlijk',   color: 'text-stone' },
]

export function WriteAwayModal({ onClose, standalone }: WriteAwayModalProps) {
  const addWriteAwayEntry = useStore(s => s.addWriteAwayEntry)
  const updateWriteAwayEntry = useStore(s => s.updateWriteAwayEntry)
  const addTask = useStore(s => s.addTask)

  const [text, setText] = useState('')
  const [tag, setTag] = useState<Tag>('work')
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [text, tag]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed) return

    const entryId = addWriteAwayEntry({ text: trimmed, tag })

    if (tag === 'urgent-work') {
      const taskId = addTask(trimmed, undefined)
      updateWriteAwayEntry(entryId, { taskId })
    }

    if (standalone) {
      setSubmitted(true)
    } else {
      onClose()
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-card rounded-[16px] shadow-2xl border border-border
        w-[520px] max-w-[94vw] p-6 animate-scale-in">

        {submitted ? (
          <div className="py-10 text-center space-y-3">
            <div className="text-[40px]">✓</div>
            <div className="text-[15px] font-medium text-charcoal">Weggeschreven.</div>
            <p className="text-[13px] text-stone/50">Je kunt dit tabblad sluiten.</p>
          </div>
        ) : (
          <>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-stone/40 hover:text-stone transition-colors"
            >
              <X size={16} />
            </button>

            <h2 className="text-[13px] uppercase tracking-[0.08em] text-stone font-medium mb-4">
              Schrijf het weg
            </h2>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Afleiding of frustratie... schrijf het gewoon op."
              rows={4}
              className="w-full px-3 py-2.5 text-[14px] text-charcoal placeholder:text-stone/30
                border border-border rounded-[8px] bg-canvas outline-none
                focus:border-stone/40 resize-none leading-relaxed"
            />

            {/* Tag selection */}
            <div className="flex items-center gap-4 mt-3">
              {TAG_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="write-away-tag"
                    value={opt.value}
                    checked={tag === opt.value}
                    onChange={() => setTag(opt.value)}
                    className="accent-charcoal"
                  />
                  <span className={`text-[12px] font-medium ${tag === opt.value ? opt.color : 'text-stone/40'}`}>
                    {opt.label}
                    {opt.value === 'urgent-work' && tag === 'urgent-work' && (
                      <Zap size={9} className="inline ml-1 text-red-500" />
                    )}
                  </span>
                </label>
              ))}
            </div>

            {tag === 'urgent-work' && (
              <p className="mt-2 text-[11px] text-red-500/60">
                Maakt een losse taak aan in je inbox.
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="mt-4 w-full py-2.5 rounded-[8px] bg-charcoal text-canvas text-[13px]
                font-medium hover:bg-charcoal/90 transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Dump & Klaar
              <span className="text-canvas/40 text-[11px] ml-2">⌘↵</span>
            </button>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
