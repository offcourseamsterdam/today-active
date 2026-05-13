import { useState, useRef, useEffect } from 'react'
import type { TaskType } from '../../types'

interface TierBadgeProps {
  tier: TaskType
  itemType: 'project' | 'task' | 'meeting'
  onChange: (newTier: TaskType) => void
  disabled?: boolean
}

const TIER_STYLES: Record<TaskType, { bg: string; text: string; label: string }> = {
  deep: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'DEEP' },
  short: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'SHORT' },
  maintenance: { bg: 'bg-stone-100', text: 'text-stone-600', label: 'MAINT' },
  reminder: { bg: 'bg-teal-100', text: 'text-teal-700', label: 'REMIND' },
}

export function TierBadge({ tier, itemType, onChange, disabled }: TierBadgeProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const style = TIER_STYLES[tier]
  // Tasks can't be deep
  const availableTiers: TaskType[] = itemType === 'task'
    ? (['short', 'maintenance', 'reminder'] as const).filter(t => t !== tier)
    : (['deep', 'short', 'maintenance', 'reminder'] as const).filter(t => t !== tier)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen(!open)
        }}
        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider
          ${style.bg} ${style.text} ${disabled ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}
          transition-opacity select-none`}
      >
        {style.label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white rounded-lg shadow-lg border border-[#E8E4DD]
          py-1 min-w-[80px] animate-[scale-in_100ms_ease-out]">
          {availableTiers.map(t => {
            const s = TIER_STYLES[t]
            return (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(t)
                  setOpen(false)
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-[#FAF9F7] transition-colors
                  flex items-center gap-2"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider ${s.bg} ${s.text}`}>
                  {s.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
