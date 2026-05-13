import { Check, Calendar, Moon, X } from 'lucide-react'
import { addDays } from 'date-fns'
import { useStore } from '../../store'
import { normalizeWaitingOn } from '../../lib/utils'
import { WaitingBadge } from './WaitingBadge'
import type { WaitingOn } from '../../types'

interface WaitingEntryRowProps {
  entry: WaitingOn
  entryIndex: number
  projectId: string
  projectTitle: string
  /** Show "Project · Person" instead of just "Person". Default false. */
  showProject?: boolean
  /** Reveal action buttons only on row hover. Default false. */
  actionsHoverOnly?: boolean
  /** Optional click handler for the label area (opens project). If omitted, falls back to store.setOpenProjectId. */
  onLabelClick?: () => void
}

export function WaitingEntryRow({
  entry, entryIndex, projectId, projectTitle,
  showProject = false, actionsHoverOnly = false, onLabelClick,
}: WaitingEntryRowProps) {
  const updateProject = useStore(s => s.updateProject)
  const addOrphanTask = useStore(s => s.addOrphanTask)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const addMaintenanceTask = useStore(s => s.addMaintenanceTask)
  const setOpenProjectId = useStore(s => s.setOpenProjectId)
  const projects = useStore(s => s.projects)

  function withUpdatedEntry(transform: (entry: WaitingOn) => WaitingOn | null) {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    const current = normalizeWaitingOn(project.waitingOn)
    const updated: WaitingOn[] = []
    current.forEach((e, i) => {
      if (i === entryIndex) {
        const next = transform(e)
        if (next) updated.push(next)
      } else {
        updated.push(e)
      }
    })
    updateProject(projectId, { waitingOn: updated.length > 0 ? updated : undefined })
  }

  function handleFollowedUp(e: React.MouseEvent) {
    e.stopPropagation()
    withUpdatedEntry(entry => ({ ...entry, since: new Date().toISOString(), snoozedUntil: undefined }))
  }

  function handleNudgeToday(e: React.MouseEvent) {
    e.stopPropagation()
    const title = `Volg op bij ${entry.person} — ${projectTitle}`
    const id = addOrphanTask(title)
    updateOrphanTask(id, { taskType: 'maintenance' })
    addMaintenanceTask(id)
  }

  function handleSnooze(e: React.MouseEvent) {
    e.stopPropagation()
    const snoozedUntil = addDays(new Date(), 3).toISOString()
    withUpdatedEntry(entry => ({ ...entry, snoozedUntil }))
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    withUpdatedEntry(() => null)
  }

  function handleLabelClick() {
    if (onLabelClick) onLabelClick()
    else setOpenProjectId(projectId)
  }

  const actionVisibility = actionsHoverOnly
    ? 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
    : 'opacity-60 hover:opacity-100'

  return (
    <div className="flex items-center gap-3 py-2 group">
      <button
        onClick={handleLabelClick}
        className="flex-1 min-w-0 text-left flex items-center gap-2 cursor-pointer"
      >
        {showProject && (
          <>
            <span className="text-[11px] text-stone/55 truncate max-w-[160px]">{projectTitle}</span>
            <span className="text-stone/25 text-[10px]">·</span>
          </>
        )}
        <span className="text-[13px] text-charcoal truncate flex-1">{entry.person}</span>
        <WaitingBadge since={entry.since} shape="rounded-full" variant="compact" />
      </button>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={handleFollowedUp}
          title="Followed up — reset timer"
          className={`p-1 rounded text-stone hover:text-emerald-600 hover:bg-emerald-50 transition-all ${actionVisibility}`}
        >
          <Check size={13} />
        </button>
        <button
          onClick={handleNudgeToday}
          title="Add follow-up task to today"
          className={`p-1 rounded text-stone hover:text-indigo-600 hover:bg-indigo-50 transition-all ${actionVisibility}`}
        >
          <Calendar size={13} />
        </button>
        <button
          onClick={handleSnooze}
          title="Snooze 3 days"
          className={`p-1 rounded text-stone hover:text-amber-600 hover:bg-amber-50 transition-all ${actionVisibility}`}
        >
          <Moon size={13} />
        </button>
        <button
          onClick={handleRemove}
          title="Remove"
          className={`p-1 rounded text-stone hover:text-red-600 hover:bg-red-50 transition-all ${actionVisibility}`}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
