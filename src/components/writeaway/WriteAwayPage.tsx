import { useStore } from '../../store'
import { Trash2, Zap, Copy, Check, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { auth } from '../../lib/firebase'

const TAG_LABELS: Record<string, { label: string; className: string }> = {
  'urgent-work': { label: 'Urgent werk', className: 'bg-red-50 text-red-600 border-red-100' },
  'work':        { label: 'Werk',        className: 'bg-stone/8 text-stone border-stone/20' },
  'personal':    { label: 'Persoonlijk', className: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy} className="text-stone/40 hover:text-stone transition-colors flex-shrink-0">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  )
}

function RaycastSetup() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const uid = auth.currentUser?.uid

  const secret = settings.writeAwaySecret

  function generate() {
    updateSettings({ writeAwaySecret: uuid() })
  }

  if (!uid) return null

  return (
    <div className="mb-8 rounded-[10px] border border-border bg-card p-5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-3">
        Raycast / Desktop Setup
      </div>
      <p className="text-[12px] text-stone/60 mb-4 leading-relaxed">
        Gebruik deze gegevens om de Raycast-extensie in te stellen. Voeg ze ook toe als Vercel env vars.
      </p>

      <div className="space-y-2.5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.06em] text-stone/40 mb-1">WRITE_AWAY_UID</div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] bg-canvas border border-border font-mono text-[12px] text-charcoal">
            <span className="flex-1 truncate">{uid}</span>
            <CopyButton value={uid} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-[0.06em] text-stone/40">WRITE_AWAY_SECRET</div>
            <button onClick={generate} className="text-[10px] text-stone/40 hover:text-stone flex items-center gap-1 transition-colors">
              <RefreshCw size={9} /> {secret ? 'Vernieuwen' : 'Genereer'}
            </button>
          </div>
          {secret ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] bg-canvas border border-border font-mono text-[12px] text-charcoal">
              <span className="flex-1 truncate">{secret}</span>
              <CopyButton value={secret} />
            </div>
          ) : (
            <button
              onClick={generate}
              className="w-full py-2 rounded-[6px] border border-dashed border-stone/20 text-[12px] text-stone/40 hover:text-stone hover:border-stone/40 transition-colors"
            >
              Genereer secret key
            </button>
          )}
        </div>
      </div>

      {secret && (
        <p className="mt-3 text-[11px] text-stone/40 leading-relaxed">
          Voeg ook <code className="bg-stone/8 px-1 rounded text-[10px]">FIREBASE_PROJECT_ID</code>,{' '}
          <code className="bg-stone/8 px-1 rounded text-[10px]">FIREBASE_CLIENT_EMAIL</code> en{' '}
          <code className="bg-stone/8 px-1 rounded text-[10px]">FIREBASE_PRIVATE_KEY</code> toe in Vercel
          (uit je Firebase service account JSON).
        </p>
      )}
    </div>
  )
}

export function WriteAwayPage() {
  const entries = useStore(s => s.writeAwayEntries)
  const deleteWriteAwayEntry = useStore(s => s.deleteWriteAwayEntry)

  return (
    <div className="max-w-[640px] mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-6">
        Write Away — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </h1>

      <RaycastSetup />

      {entries.length === 0 ? (
        <p className="text-[13px] text-stone/40 py-12 text-center">
          Nog niets weggeschreven.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map(entry => {
            const tag = TAG_LABELS[entry.tag] ?? TAG_LABELS['work']
            return (
              <li
                key={entry.id}
                className="rounded-[10px] border border-border bg-card p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] text-charcoal leading-relaxed flex-1 whitespace-pre-wrap">
                    {entry.text}
                  </p>
                  <button
                    onClick={() => deleteWriteAwayEntry(entry.id)}
                    className="opacity-0 group-hover:opacity-40 hover:!opacity-100
                      text-stone hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${tag.className}`}>
                    {tag.label}
                  </span>
                  {entry.taskId && (
                    <span className="text-[10px] text-stone/50 flex items-center gap-1">
                      <Zap size={9} />
                      taak aangemaakt
                    </span>
                  )}
                  <span className="text-[10px] text-stone/30 ml-auto">
                    {format(new Date(entry.createdAt), 'd MMM, HH:mm', { locale: nl })}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
