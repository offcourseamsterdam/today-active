import { useState, useCallback, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'
import {
  Inbox,
  FolderKanban,
  RotateCcw,
  Flag,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import InboxSection, { type InboxActions } from './InboxSection'
import ProjectsSection from './ProjectsSection'
import { useStore } from '../../store'
import { useReviewKeyboard } from '../../hooks/useReviewKeyboard'
import { RecurringSection } from './RecurringSection'
import { SummarySection, type ReviewStats } from './SummarySection'

type SectionId = 'inbox' | 'projects' | 'recurring' | 'summary'

const SECTIONS: {
  id: SectionId
  label: string
  icon: typeof Inbox
}[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'projects', label: 'Projecten', icon: FolderKanban },
  { id: 'recurring', label: 'Recurring', icon: RotateCcw },
  { id: 'summary', label: 'Samenvatting', icon: Flag },
]

const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id)

const EMPTY_STATS: ReviewStats = {
  inboxProcessed: 0,
  inboxToProject: 0,
  inboxKept: 0,
  inboxDeleted: 0,
  tasksCompleted: 0,
  tasksDeleted: 0,
  projectsMoved: 0,
  recurringDeactivated: 0,
}

export function WeeklyReviewPage() {
  const [completedSections, setCompletedSections] = useState<Set<SectionId>>(
    new Set(),
  )
  const [activeSection, setActiveSection] = useState<SectionId>('inbox')
  const [finished, setFinished] = useState(false)
  const [stats, setStats] = useState<ReviewStats>(EMPTY_STATS)

  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
    inbox: null,
    projects: null,
    recurring: null,
    summary: null,
  })

  const inboxActionsRef = useRef<InboxActions | null>(null)
  const [focusedProjectIndex, setFocusedProjectIndex] = useState(0)
  const [, setExpandedProjectIndices] = useState<Set<number>>(new Set())

  const projects = useStore(s => s.projects)
  const projectCount = projects.length

  const toggleProjectExpanded = useCallback((index: number) => {
    setExpandedProjectIndices(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  useReviewKeyboard({
    activeSection,
    setActiveSection,
    sectionRefs: sectionRefs.current,
    inboxActionsRef,
    focusedProjectIndex,
    setFocusedProjectIndex,
    projectCount,
    toggleProjectExpanded,
  })

  const markSectionDone = useCallback(
    (id: SectionId) => {
      setCompletedSections((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })

      // Auto-open next section
      const idx = SECTION_IDS.indexOf(id)
      if (idx < SECTION_IDS.length - 1) {
        const nextId = SECTION_IDS[idx + 1]
        setActiveSection(nextId)
        setTimeout(() => {
          sectionRefs.current[nextId]?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        }, 100)
      }
    },
    [],
  )

  const handleInboxStats = useCallback(
    (processed: number, toProject: number, kept: number, deleted: number) => {
      setStats((prev) => ({
        ...prev,
        inboxProcessed: processed,
        inboxToProject: toProject,
        inboxKept: kept,
        inboxDeleted: deleted,
      }))
    },
    [],
  )

  const handleTaskCompleted = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      tasksCompleted: prev.tasksCompleted + 1,
    }))
  }, [])

  const handleTaskDeleted = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      tasksDeleted: prev.tasksDeleted + 1,
    }))
  }, [])

  const handleProjectMoved = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      projectsMoved: prev.projectsMoved + 1,
    }))
  }, [])

  const handleDeactivated = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      recurringDeactivated: prev.recurringDeactivated + 1,
    }))
  }, [])

  const handleFinish = useCallback(() => {
    setCompletedSections(new Set(SECTION_IDS))
    setFinished(true)
  }, [])

  const todayFormatted = useMemo(() => format(new Date(), 'EEEE d MMMM yyyy', { locale: nl }), [])
  const setActiveView = useStore(s => s.setActiveView)

  function handleDoneWithReview() {
    handleFinish()
    setTimeout(() => setActiveView('kanban'), 400)
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 pb-12">
      {/* Header */}
      <div className="pt-8 pb-6 flex items-end justify-between">
        <div>
          <h1 className="font-[Fraunces] text-2xl text-charcoal">
            Weekly Review
          </h1>
          <p className="text-[13px] text-stone mt-1">{todayFormatted}</p>
        </div>
        <button
          onClick={handleDoneWithReview}
          className="text-[13px] italic font-serif text-stone/50 hover:text-charcoal transition-colors pb-1"
        >
          Review afronden →
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex items-center justify-center gap-0 mb-8">
        {SECTIONS.map((section, i) => {
          const done = completedSections.has(section.id)
          const isActive = activeSection === section.id
          const Icon = section.icon
          const prevDone = i > 0 && completedSections.has(SECTIONS[i - 1].id)

          return (
            <div key={section.id} className="flex items-center">
              {/* Connecting line before (except first) */}
              {i > 0 && (
                <div
                  className={`w-10 h-0.5 ${
                    prevDone ? 'bg-green-500' : 'bg-stone/10'
                  }`}
                />
              )}

              {/* Circle + label */}
              <button
                type="button"
                onClick={() => setActiveSection(section.id)}
                className="flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium transition-colors ${
                    done
                      ? 'bg-green-500 text-white'
                      : isActive
                        ? 'border-2 border-charcoal text-charcoal'
                        : 'border-2 border-stone/20 text-stone/40'
                  }`}
                >
                  {done ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Icon
                    size={12}
                    className={
                      done
                        ? 'text-green-600'
                        : isActive
                          ? 'text-charcoal'
                          : 'text-stone/40'
                    }
                  />
                  <span
                    className={`text-[11px] font-medium ${
                      done
                        ? 'text-green-600'
                        : isActive
                          ? 'text-charcoal'
                          : 'text-stone/40'
                    }`}
                  >
                    {section.label}
                  </span>
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {/* Finished banner */}
      {finished && (
        <div className="flex items-center gap-2 px-4 py-3 mb-6 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[13px] font-medium">
          <Check size={16} />
          Review afgerond! Fijne week.
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {SECTIONS.map((section) => {
          const done = completedSections.has(section.id)
          const isOpen = activeSection === section.id
          const Icon = section.icon

          return (
            <div
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el
              }}
              className={`border rounded-[10px] transition-colors ${
                done
                  ? 'border-green-200 bg-green-50/30'
                  : 'border-border bg-white'
              }`}
            >
              {/* Section header */}
              <button
                type="button"
                onClick={() => setActiveSection(section.id)}
                className="w-full flex items-center gap-2.5 px-5 py-3.5 cursor-pointer"
              >
                {isOpen ? (
                  <ChevronDown size={14} className="text-stone shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-stone shrink-0" />
                )}
                <Icon
                  size={16}
                  className={done ? 'text-green-600 shrink-0' : 'text-charcoal shrink-0'}
                />
                <span
                  className={`text-[14px] font-medium ${
                    done ? 'text-green-700' : 'text-charcoal'
                  }`}
                >
                  {section.label}
                </span>
                {done && (
                  <span className="ml-auto text-[11px] font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                    Klaar
                  </span>
                )}
              </button>

              {/* Section content */}
              <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}>
                <div className="overflow-hidden">
                  <div className="px-5 pb-5 border-t border-border/30">
                    <div className="pt-4">
                      {section.id === 'inbox' && (
                        <InboxSection
                          actionsRef={inboxActionsRef}
                          onStats={handleInboxStats}
                          onAllProcessed={() => {
                            setTimeout(() => markSectionDone('inbox'), 800)
                          }}
                        />
                      )}
                      {section.id === 'projects' && (
                        <ProjectsSection
                          onTaskCompleted={handleTaskCompleted}
                          onTaskDeleted={handleTaskDeleted}
                          onProjectMoved={handleProjectMoved}
                        />
                      )}
                      {section.id === 'recurring' && (
                        <RecurringSection onDeactivated={handleDeactivated} />
                      )}
                      {section.id === 'summary' && (
                        <SummarySection
                          stats={stats}
                          onFinish={handleFinish}
                        />
                      )}
                    </div>

                    {/* "Sectie afvinken" button (not for summary — it has its own finish button) */}
                    {section.id !== 'summary' && !done && (
                      <div className="mt-4 pt-3 border-t border-border/20">
                        <button
                          type="button"
                          onClick={() => markSectionDone(section.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors cursor-pointer"
                        >
                          <Check size={14} />
                          Sectie afvinken
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
