import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, Calendar, Moon, X, type LucideIcon } from 'lucide-react'
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
  /** Optional click handler for the label area (opens project). If omitted, falls back to store.setOpenProjectId. */
  onLabelClick?: () => void
}

export function WaitingEntryRow({
  entry, entryIndex, projectId, projectTitle,
  showProject = false, onLabelClick,
}: WaitingEntryRowProps) {
  const updateProject = useStore(s => s.updateProject)
  const addOrphanTask = useStore(s => s.addOrphanTask)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const addMaintenanceTask = useStore(s => s.addMaintenanceTask)
  const setOpenProjectId = useStore(s => s.setOpenProjectId)
  const projects = useStore(s => s.projects)

  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  function openMenu() {
    cancelClose()
    setMenuOpen(true)
  }
  function scheduleClose() {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setMenuOpen(false), 120)
  }

  useEffect(() => () => cancelClose(), [])

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

  function handleFollowedUp() {
    withUpdatedEntry(e => ({ ...e, since: new Date().toISOString(), snoozedUntil: undefined }))
    setMenuOpen(false)
  }
  function handleNudgeToday() {
    const title = `Volg op bij ${entry.person} — ${projectTitle}`
    const id = addOrphanTask(title)
    updateOrphanTask(id, { taskType: 'maintenance' })
    addMaintenanceTask(id)
    setMenuOpen(false)
  }
  function handleSnooze() {
    const snoozedUntil = addDays(new Date(), 3).toISOString()
    withUpdatedEntry(e => ({ ...e, snoozedUntil }))
    setMenuOpen(false)
  }
  function handleRemove() {
    withUpdatedEntry(() => null)
    setMenuOpen(false)
  }

  function handleLabelClick() {
    if (onLabelClick) onLabelClick()
    else setOpenProjectId(projectId)
  }

  return (
    <div
      ref={rowRef}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      className="relative"
    >
      <button
        onClick={handleLabelClick}
        className={`w-full text-left flex items-center gap-2 px-2 py-2 -mx-2 rounded-[6px]
          transition-colors cursor-pointer
          ${menuOpen ? 'bg-border-light/60' : 'hover:bg-border-light/40'}`}
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

      {menuOpen && rowRef.current && (
        <ActionPopover
          anchor={rowRef.current}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
          onFollowedUp={handleFollowedUp}
          onNudge={handleNudgeToday}
          onSnooze={handleSnooze}
          onRemove={handleRemove}
        />
      )}
    </div>
  )
}

// ─── Hover popover ───────────────────────────────────────────────

interface ActionPopoverProps {
  anchor: HTMLElement
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFollowedUp: () => void
  onNudge: () => void
  onSnooze: () => void
  onRemove: () => void
}

function ActionPopover({
  anchor, onMouseEnter, onMouseLeave,
  onFollowedUp, onNudge, onSnooze, onRemove,
}: ActionPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Position below the anchor, right-aligned to the anchor's right edge.
    // Flip above if there's not enough room below.
    const rect = anchor.getBoundingClientRect()
    const MENU_WIDTH = 200
    const MENU_HEIGHT_EST = 168
    const GAP = 4
    const viewportH = window.innerHeight

    const wantsTop = rect.bottom + GAP + MENU_HEIGHT_EST > viewportH
    const top = wantsTop
      ? rect.top - MENU_HEIGHT_EST - GAP + window.scrollY
      : rect.bottom + GAP + window.scrollY
    const left = Math.max(8, rect.right - MENU_WIDTH + window.scrollX)
    setPos({ top, left })
  }, [anchor])

  if (!pos) return null

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left, width: 200 }}
      className="z-50 bg-card border border-border rounded-[10px] shadow-xl py-1
        animate-fade-in"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <MenuItem icon={Check} label="Followed up" hint="reset timer" onClick={onFollowedUp} />
      <MenuItem icon={Calendar} label="Nudge today" hint="adds task" onClick={onNudge} />
      <MenuItem icon={Moon} label="Snooze 3 days" onClick={onSnooze} />
      <div className="border-t border-border/60 my-1" />
      <MenuItem icon={X} label="Remove" onClick={onRemove} variant="danger" />
    </div>,
    document.body
  )
}

interface MenuItemProps {
  icon: LucideIcon
  label: string
  hint?: string
  onClick: () => void
  variant?: 'default' | 'danger'
}

function MenuItem({ icon: Icon, label, hint, onClick, variant = 'default' }: MenuItemProps) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`w-full px-3 py-1.5 flex items-center gap-2.5 text-left text-[12px]
        hover:bg-border-light/60 transition-colors
        ${variant === 'danger' ? 'text-red-600 hover:text-red-700' : 'text-charcoal'}`}
    >
      <Icon size={13} className={variant === 'danger' ? 'text-red-500' : 'text-stone'} />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-stone/40">{hint}</span>}
    </button>
  )
}
