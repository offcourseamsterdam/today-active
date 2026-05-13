import { daysSince, getWaitingStatus, getWaitingLabel } from '../../lib/utils'

interface WaitingBadgeProps {
  since: string
  shape?: 'rounded' | 'rounded-full'
  /** "verbose" shows "X days — time to act"; "compact" shows "Xd". Default verbose. */
  variant?: 'verbose' | 'compact'
}

export function WaitingBadge({ since, shape = 'rounded', variant = 'verbose' }: WaitingBadgeProps) {
  const days = daysSince(since)
  const status = getWaitingStatus(days)
  const label = variant === 'compact' ? `${days}d` : getWaitingLabel(days)
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 whitespace-nowrap tabular-nums
      ${shape === 'rounded-full' ? 'rounded-full' : 'rounded'}
      ${status === 'red'
        ? 'bg-[var(--color-status-red-bg)] text-[var(--color-status-red-text)]'
        : status === 'amber'
          ? 'bg-[var(--color-status-amber-bg)] text-[var(--color-status-amber-text)]'
          : 'bg-border-light text-stone'}`}>
      {label}
    </span>
  )
}
