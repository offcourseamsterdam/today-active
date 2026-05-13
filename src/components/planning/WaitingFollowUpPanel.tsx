import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { useStore } from '../../store'
import { normalizeWaitingOn, isWaitingSnoozed, daysSince, getWaitingStatus } from '../../lib/utils'
import { WaitingEntryRow } from '../ui/WaitingEntryRow'
import type { WaitingOn } from '../../types'

interface FlatEntry {
  entry: WaitingOn
  entryIndex: number
  projectId: string
  projectTitle: string
  days: number
  status: 'normal' | 'amber' | 'red'
}

const STATUS_RANK: Record<FlatEntry['status'], number> = { red: 0, amber: 1, normal: 2 }

export function WaitingFollowUpPanel() {
  const projects = useStore(s => s.projects)
  const [collapsed, setCollapsed] = useState(false)

  const entries = useMemo<FlatEntry[]>(() => {
    const today = new Date()
    const out: FlatEntry[] = []
    for (const p of projects) {
      if (p.status === 'done') continue
      const list = normalizeWaitingOn(p.waitingOn)
      list.forEach((entry, entryIndex) => {
        if (isWaitingSnoozed(entry, today)) return
        const days = daysSince(entry.since)
        if (days < 1) return
        out.push({
          entry, entryIndex,
          projectId: p.id, projectTitle: p.title,
          days, status: getWaitingStatus(days),
        })
      })
    }
    return out.sort((a, b) => {
      const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (rank !== 0) return rank
      return a.entry.since.localeCompare(b.entry.since)
    })
  }, [projects])

  if (entries.length === 0) return null

  return (
    <div className="rounded-[10px] border border-border bg-card/50 overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-card transition-colors"
      >
        {collapsed
          ? <ChevronRight size={13} className="text-stone/50" />
          : <ChevronDown size={13} className="text-stone/50" />
        }
        <Clock size={12} className="text-stone/50" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium">
          Following up
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-border-light text-stone">
          {entries.length}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 border-t border-border/50">
          {entries.map(e => (
            <WaitingEntryRow
              key={`${e.projectId}-${e.entryIndex}`}
              entry={e.entry}
              entryIndex={e.entryIndex}
              projectId={e.projectId}
              projectTitle={e.projectTitle}
              showProject
            />
          ))}
        </div>
      )}
    </div>
  )
}
