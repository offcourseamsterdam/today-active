import { useState } from 'react'
import { X, Target, Check, Clock } from 'lucide-react'
import { useStore } from '../../store'
import { CategoryBadge } from '../ui/CategoryBadge'
import { findMeetingById } from '../../lib/meetingLookup'
import { getTodayQuote } from '../../lib/quotes'
import { getTodayString } from '../../store/helpers'

interface DeepBlockProps {
  onOpenMeetings?: () => void
}

export function DeepBlock({ onOpenMeetings }: DeepBlockProps) {
  const projects = useStore(s => s.projects)
  const rawPlan = useStore(s => s.dailyPlan)
  const dailyPlan = rawPlan?.date === getTodayString() ? rawPlan : null
  const allMeetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)
  const setDeepBlock = useStore(s => s.setDeepBlock)
  const clearDeepBlock = useStore(s => s.clearDeepBlock)
  const completeDeepBlock = useStore(s => s.completeDeepBlock)
  const setDeepMeeting = useStore(s => s.setDeepMeeting)
  const setOpenProjectId = useStore(s => s.setOpenProjectId)
  const showToast = useStore(s => s.showToast)

  const [intention, setIntention] = useState(dailyPlan?.deepBlock.intention || '')
  const [editingIntention, setEditingIntention] = useState(false)

  const selectedProjectId = dailyPlan?.deepBlock.projectId || ''
  const selectedProject = projects.find(p => p.id === selectedProjectId)

  const deepMeetingId = dailyPlan?.deepMeetingId
  const deepMeeting = deepMeetingId
    ? findMeetingById(deepMeetingId, allMeetings, recurringMeetings)
    : null

  const completedProjectTitle = dailyPlan?.deepBlock.completedProjectTitle
  const isDoneToday = !!(completedProjectTitle && dailyPlan?.deepBlock.completedAt)

  function handleClear() {
    clearDeepBlock()
    setIntention('')
  }

  function handleDoneForToday() {
    if (selectedProject) {
      showToast(selectedProject.id)
      completeDeepBlock(selectedProject.title)
    } else {
      clearDeepBlock()
    }
    setIntention('')
  }

  function handleIntentionSubmit() {
    if (selectedProjectId) {
      setDeepBlock(selectedProjectId, intention || undefined)
    }
    setEditingIntention(false)
  }

  return (
    <div className="bg-card rounded-[10px] p-5 shadow-card border border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-cat-marketing" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium">
            Deep block
          </span>
          <span className="text-[11px] text-stone/50">3 hours, 1 project</span>
        </div>
      </div>

      {isDoneToday ? (
        <DeepBlockComplete projectTitle={completedProjectTitle!} />
      ) : deepMeeting ? (
        /* Deep meeting card */
        <div
          className="flex items-center gap-3 py-2 cursor-pointer hover:bg-canvas rounded-[6px] px-1 -mx-1 transition-colors group"
          onClick={onOpenMeetings}
        >
          <Clock size={14} className="text-cat-marketing flex-shrink-0" />
          <span className="text-[11px] text-stone/50 font-mono flex-shrink-0">{deepMeeting.time}</span>
          <span className="text-[15px] font-medium text-charcoal flex-1 truncate">{deepMeeting.title}</span>
          <span className="text-[12px] text-stone/40 flex-shrink-0">{deepMeeting.durationMinutes}m</span>
          <button
            onClick={e => { e.stopPropagation(); setDeepMeeting(undefined) }}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all"
          >
            <X size={14} />
          </button>
        </div>
      ) : selectedProject ? (
        <div>
          {/* Selected project display */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                {selectedProject.coverImageUrl && (
                  <div className="w-10 h-10 rounded-[4px] overflow-hidden flex-shrink-0">
                    <img src={selectedProject.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div>
                  <button
                    onClick={() => setOpenProjectId(selectedProject.id)}
                    className="text-[15px] font-medium text-charcoal hover:text-stone transition-colors text-left"
                  >
                    {selectedProject.title}
                  </button>
                  <CategoryBadge category={selectedProject.category} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleDoneForToday}
                title="Done for today"
                className="text-stone/30 hover:text-green transition-colors p-1"
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleClear}
                className="text-stone/40 hover:text-stone transition-colors p-1"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Intention */}
          {editingIntention ? (
            <input
              value={intention}
              onChange={e => setIntention(e.target.value)}
              onBlur={handleIntentionSubmit}
              onKeyDown={e => e.key === 'Enter' && handleIntentionSubmit()}
              placeholder="What progress will I make today?"
              autoFocus
              className="w-full px-3 py-2 rounded-[6px] border border-border bg-canvas
                text-[13px] text-charcoal placeholder:text-stone/30
                outline-none focus:border-stone/40 transition-colors mb-4"
            />
          ) : (
            <button
              onClick={() => setEditingIntention(true)}
              className="text-[13px] text-stone/50 hover:text-stone mb-4 block transition-colors italic"
            >
              {intention || 'What progress will I make today?'}
            </button>
          )}

          {/* Task preview */}
          {selectedProject.tasks.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-[10px] uppercase tracking-wider text-stone/50 mb-2">
                Tasks in this project
              </div>
              {selectedProject.tasks
                .filter(t => t.status !== 'done')
                .slice(0, 3)
                .map(task => (
                  <button
                    key={task.id}
                    onClick={() => setOpenProjectId(selectedProject.id)}
                    className="text-[12px] text-stone py-0.5 flex items-center gap-2 hover:text-charcoal transition-colors w-full text-left"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-stone/20 flex-shrink-0" />
                    {task.title}
                  </button>
                ))}
              {selectedProject.tasks.filter(t => t.status !== 'done').length > 3 && (
                <div className="text-[11px] text-stone/40 mt-1">
                  +{selectedProject.tasks.filter(t => t.status !== 'done').length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyDeepBlock />
      )}
    </div>
  )
}

function EmptyDeepBlock() {
  const quote = getTodayQuote()
  return (
    <div className="py-5 px-2 text-center">
      <p className="font-serif text-[14px] text-stone/60 italic leading-relaxed mb-2">
        "{quote.text}"
      </p>
      {quote.source && (
        <p className="text-[10px] text-stone/35">
          — Oliver Burkeman, {quote.source}
        </p>
      )}
    </div>
  )
}

function DeepBlockComplete({ projectTitle }: { projectTitle: string }) {
  const quote = getTodayQuote()
  return (
    <div className="flex flex-col items-center justify-center py-8 px-6 text-center"
         style={{ minHeight: '200px' }}>
      {/* Animated checkmark */}
      <div
        className="text-[28px] mb-4"
        style={{
          animation: 'deepBlockComplete 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          color: '#4a9563',
        }}
      >
        ✓
      </div>

      {/* Project title + label */}
      <div
        style={{
          animation: 'fadeUpIn 0.4s ease forwards',
          animationDelay: '0.15s',
          opacity: 0,
        }}
      >
        <p className="font-serif text-[18px] text-charcoal tracking-[-0.01em] mb-1">
          {projectTitle}
        </p>
        <p className="text-[10px] uppercase tracking-[0.1em] text-stone/60 mb-5">
          Deep work — done for today
        </p>
      </div>

      {/* Burkeman quote */}
      <div
        className="max-w-[280px]"
        style={{
          animation: 'fadeUpIn 0.4s ease forwards',
          animationDelay: '0.3s',
          opacity: 0,
        }}
      >
        <p className="font-serif text-[12px] text-stone/70 italic leading-relaxed mb-1.5">
          "{quote.text}"
        </p>
        {quote.source && (
          <p className="text-[10px] text-stone/40">
            — Oliver Burkeman, {quote.source}
          </p>
        )}
      </div>
    </div>
  )
}

