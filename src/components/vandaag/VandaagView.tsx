import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { useStore } from '../../store'
import { DailyPlanList } from './DailyPlanList'
import { InlinePomodoroTimer } from './InlinePomodoroTimer'
import { MiniTimerBar } from './MiniTimerBar'
import { getTodayQuote } from '../../lib/quotes'
import { useVandaagDark } from './VandaagDarkContext'

interface VandaagViewProps {
  onDayDone: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  onPeekTomorrow: () => void
  onOpenMeetings: () => void
}

export function VandaagView({ onDayDone, collapsed, onToggleCollapse, onPeekTomorrow, onOpenMeetings }: VandaagViewProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const projects = useStore(s => s.projects)
  const getMissionCriticalStats = useStore(s => s.getMissionCriticalStats)

  const dark = useVandaagDark()

  const shortTaskIds = dailyPlan?.shortTasks || []
  const maintenanceTaskIds = dailyPlan?.maintenanceTasks || []
  const meetingIds = dailyPlan?.meetings ?? []
  const deepBlockProjectId = dailyPlan?.deepBlock.projectId || ''
  const deepBlockProject = projects.find(p => p.id === deepBlockProjectId)

  const hasDeepBlock = !!deepBlockProjectId
  const quote = getTodayQuote()

  // Stats
  const { missionCriticalDays } = getMissionCriticalStats()

  const tiersActive = [
    hasDeepBlock,
    shortTaskIds.length > 0,
    maintenanceTaskIds.length > 0,
  ].filter(Boolean).length

  const statusText =
    tiersActive === 3
      ? 'All three tiers planned. That\u2019s a good day.'
      : tiersActive === 2
        ? 'Two tiers set. One more to go.'
        : tiersActive === 1
          ? 'Getting started.'
          : null

  // Tomorrow peek summary
  const tomorrowDeepProjectId = tomorrowPlan?.deepBlock.projectId
  const tomorrowDeepProject = tomorrowDeepProjectId
    ? projects.find(p => p.id === tomorrowDeepProjectId)
    : undefined
  const tomorrowCalendarEventId = tomorrowPlan?.deepBlock.calendarEventId

  const tomorrowIsComplete = tomorrowPlan?.isComplete === true

  const [tomorrowVisible, setTomorrowVisible] = useState(false)
  useEffect(() => {
    if (tomorrowIsComplete) {
      const t = setTimeout(() => setTomorrowVisible(true), 50)
      return () => clearTimeout(t)
    } else {
      setTomorrowVisible(false)
    }
  }, [tomorrowIsComplete])

  let tomorrowSummary = ''
  if (tomorrowPlan && tomorrowIsComplete) {
    const deepPart = tomorrowCalendarEventId
      ? 'Meeting'
      : tomorrowDeepProject
        ? tomorrowDeepProject.title
        : 'Deep block'
    const shortCount = tomorrowPlan.shortTasks.length
    const maintCount = tomorrowPlan.maintenanceTasks.length
    tomorrowSummary = `${deepPart} \u00b7 ${shortCount} short \u00b7 ${maintCount} maint`
  }

  return (
    <div className="max-w-[1400px] mx-auto mb-8">
      {/* Section header with collapse toggle */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={onToggleCollapse}
          className={`flex items-center gap-2 transition-colors group ${dark ? 'text-citadel-text/50 hover:text-citadel-text' : 'text-stone hover:text-charcoal'}`}
        >
          {collapsed
            ? <ChevronDown size={14} className={`${dark ? 'text-citadel-text/30' : 'text-stone/50'} group-hover:text-inherit transition-colors`} />
            : <ChevronUp size={14} className={`${dark ? 'text-citadel-text/30' : 'text-stone/50'} group-hover:text-inherit transition-colors`} />
          }
          <span className="text-[11px] uppercase tracking-[0.08em] font-medium">
            3 – 3 – 3
          </span>
        </button>
        <div className={`flex-1 h-px ${dark ? 'bg-citadel-text/10' : 'bg-border'}`} />

        {/* Tomorrow peek — shown when tomorrow plan is complete */}
        {tomorrowIsComplete ? (
          <button
            onClick={onPeekTomorrow}
            className={`text-[13px] cursor-pointer transition-all
              ${dark ? 'text-citadel-text/50 hover:text-citadel-text' : 'text-stone hover:text-charcoal'}
              ${tomorrowVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionProperty: 'opacity, transform', transitionDuration: '300ms' }}
          >
            Tomorrow → <span className={dark ? 'text-citadel-text/30' : 'text-stone/50'}>{tomorrowSummary}</span>
          </button>
        ) : (
          <>
            {statusText && !collapsed && (
              <span className={`text-[11px] italic font-serif ${dark ? 'text-citadel-text/40' : 'text-stone'}`}>{statusText}</span>
            )}
            {tomorrowPlan && (
              <button
                onClick={onPeekTomorrow}
                className={`text-[11px] transition-colors flex items-center gap-1 ${dark ? 'text-citadel-text/25 hover:text-citadel-text/50' : 'text-stone/40 hover:text-stone'}`}
              >
                Morgen →
              </button>
            )}
          </>
        )}
      </div>

      {/* Collapsed: compact summary row */}
      {collapsed && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 rounded-[8px] border
            shadow-card text-[12px] cursor-pointer transition-all
            ${dark
              ? 'bg-citadel-text/5 border-citadel-text/10 text-citadel-text/50 hover:border-citadel-text/20'
              : 'bg-card border-border/50 text-stone hover:border-stone/20'}`}
          onClick={onToggleCollapse}
        >
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-wider ${dark ? 'text-citadel-text/25' : 'text-stone/40'}`}>Deep block</span>
            <span className={`font-medium ${dark ? 'text-citadel-text' : 'text-charcoal'}`}>
              {deepBlockProject ? deepBlockProject.title : '—'}
            </span>
          </div>
          <div className={`w-px h-3 ${dark ? 'bg-citadel-text/10' : 'bg-border'}`} />
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-wider ${dark ? 'text-citadel-text/25' : 'text-stone/40'}`}>Short</span>
            <span className={dark ? 'text-citadel-text' : 'text-charcoal'}>{shortTaskIds.length} / 3</span>
          </div>
          {meetingIds.length > 0 && (
            <>
              <div className={`w-px h-3 ${dark ? 'bg-citadel-text/10' : 'bg-border'}`} />
              <div className="flex items-center gap-1.5">
                <Clock size={10} className={dark ? 'text-citadel-text/25' : 'text-stone/40'} />
                <span className={dark ? 'text-citadel-text' : 'text-charcoal'}>{meetingIds.length}</span>
              </div>
            </>
          )}
          <div className={`w-px h-3 ${dark ? 'bg-citadel-text/10' : 'bg-border'}`} />
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-wider ${dark ? 'text-citadel-text/25' : 'text-stone/40'}`}>Maintenance</span>
            <span className={dark ? 'text-citadel-text' : 'text-charcoal'}>{maintenanceTaskIds.length} tasks</span>
          </div>
          <div className={`ml-auto flex items-center gap-2 ${dark ? 'text-citadel-text/25' : 'text-stone/40'}`}>
            <ChevronDown size={13} />
          </div>
        </div>
      )}

      {/* Expanded: two-column layout */}
      {!collapsed && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left column: plan list + stats + quote */}
          <div className="flex-1 min-w-0">
            <DailyPlanList onOpenMeetings={onOpenMeetings} />

            {/* Stats */}
            {missionCriticalDays > 0 && (
              <div className="mt-3 flex items-center gap-5 px-1">
                <span className={`text-[11px] ${dark ? 'text-citadel-text/30' : 'text-stone/50'}`}>
                  Mission critical: <span className={dark ? 'text-citadel-text/50' : 'text-stone'}>{missionCriticalDays} days worked</span>
                </span>
              </div>
            )}

            {/* Quote + day done */}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className={`p-3 rounded-[8px] max-w-[460px] ${dark ? 'bg-citadel-text/5' : 'bg-border-light/40'}`}>
                <p className={`text-[11px] italic font-serif leading-relaxed ${dark ? 'text-citadel-text/40' : 'text-[#5A5550]'}`}>
                  &ldquo;{quote.text}&rdquo;
                </p>
                <p className={`text-[10px] mt-1 ${dark ? 'text-citadel-text/20' : 'text-stone/50'}`}>
                  Oliver Burkeman{quote.source && <> &mdash; {quote.source}</>}
                </p>
              </div>

              {tiersActive > 0 && (
                <button
                  onClick={onDayDone}
                  className={`text-[13px] transition-colors font-serif italic whitespace-nowrap pb-1
                    ${dark ? 'text-citadel-text/40 hover:text-citadel-text' : 'text-[#7A746A] hover:text-charcoal'}`}
                >
                  That&rsquo;s enough for today &rarr;
                </button>
              )}
            </div>
          </div>

          {/* Right column: inline timer (desktop only) */}
          <div className="hidden lg:block w-[320px] flex-shrink-0 sticky top-4 self-start">
            <InlinePomodoroTimer />
          </div>
        </div>
      )}

      {/* Mobile mini timer bar */}
      <MiniTimerBar />
    </div>
  )
}
