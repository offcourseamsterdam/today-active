import { useStore } from '../../store'
import { Trash2, Zap } from 'lucide-react'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'

const TAG_LABELS: Record<string, { label: string; className: string }> = {
  'urgent-work': { label: 'Urgent werk', className: 'bg-red-50 text-red-600 border-red-100' },
  'work':        { label: 'Werk',        className: 'bg-stone/8 text-stone border-stone/20' },
  'personal':    { label: 'Persoonlijk', className: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
}

export function WriteAwayPage() {
  const entries = useStore(s => s.writeAwayEntries)
  const deleteWriteAwayEntry = useStore(s => s.deleteWriteAwayEntry)

  return (
    <div className="max-w-[640px] mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-6">
        Write Away — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </h1>

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
