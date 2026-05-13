import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { X, RotateCcw, Clock, Bell } from 'lucide-react'
import { useStore } from '../../store'
import { findTaskById } from '../../lib/taskLookup'
import { findMeetingById } from '../../lib/meetingLookup'
import { useTodayPlan } from '../../hooks/useTodayPlan'
import { getTodayString } from '../../store/helpers'
import { TaskCheckbox } from '../ui/TaskCheckbox'
import { ProjectTaskPreview } from '../ui/ProjectTaskPreview'
import { getFocusTimeLabel } from '../../lib/focusTime'
import type { PomodoroLogEntry } from '../../types'

const EMPTY_LOG: PomodoroLogEntry[] = []

interface MaintenanceTierProps {
  onEnterCitadel?: (ctx: { tier: 'maintenance'; taskId: string; taskTitle: string }) => void
  onOpenMeetings?: () => void
}

export function MaintenanceTier({ onEnterCitadel, onOpenMeetings }: MaintenanceTierProps) {
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const allMeetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const updateRecurringTask = useStore(s => s.updateRecurringTask)
  const getTodayRecurringTasks = useStore(s => s.getTodayRecurringTasks)
  const inlineTimer = useStore(s => s.inlineTimer)
  const pomodoroLog = useStore(s => s.dailyPlan?.pomodoroLog) ?? EMPTY_LOG
  const {
    maintenanceTaskIds, addMaintenanceTask, removeMaintenanceTask,
    maintenanceProjectIds, removeMaintenanceProject,
    maintenanceMeetingIds, removeMaintenanceMeeting,
  } = useTodayPlan()

  // Resolve maintenance meeting IDs to objects, sorted by time
  const sortedMaintMeetings = useMemo(() => {
    return maintenanceMeetingIds
      .map(id => findMeetingById(id, allMeetings, recurringMeetings))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [maintenanceMeetingIds, allMeetings, recurringMeetings])

  const [completedToday, setCompletedToday] = useState<Set<string>>(new Set())

  function handleToggle(taskId: string) {
    const wasCompleted = completedToday.has(taskId)
    setCompletedToday(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
    const orphan = orphanTasks.find(t => t.id === taskId)
    if (orphan) {
      updateOrphanTask(taskId, {
        status: wasCompleted ? 'vandaag' : 'done',
        completedAt: wasCompleted ? undefined : new Date().toISOString(),
      })
    }
    const recurring = recurringTasks.find(t => t.id === taskId)
    if (recurring) {
      updateRecurringTask(taskId, {
        lastCompletedDate: wasCompleted ? undefined : format(new Date(), 'yyyy-MM-dd'),
      })
    }
  }

  const todayRecurring = getTodayRecurringTasks()
  const notYetAdded = todayRecurring.filter(t => !maintenanceTaskIds.includes(t.id))

  // Recurring tasks due today that haven't been checked off (not in plan, not done)
  const today = getTodayString()
  const uncheckedRecurring = todayRecurring.filter(
    t => t.lastCompletedDate !== today && !maintenanceTaskIds.includes(t.id)
  )

  function handleAutoPopulate() {
    for (const task of notYetAdded) addMaintenanceTask(task.id)
  }

  const slotsUsed = maintenanceTaskIds.length
  const completedCount = maintenanceTaskIds.filter(id => completedToday.has(id)).length

  return (
    <div className="bg-card rounded-[10px] p-5 shadow-card border border-border/50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RotateCcw size={14} className="text-cat-admin" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium">
            Maintenance
          </span>
          {slotsUsed > 0 && (
            <span className="text-[11px] text-stone/50">{completedCount}/{slotsUsed} done</span>
          )}
        </div>
        {notYetAdded.length > 0 && (
          <button
            onClick={handleAutoPopulate}
            className="text-[11px] text-stone/50 hover:text-stone px-2 py-1 rounded
              border border-border/50 hover:border-stone/20 transition-all"
          >
            + Add {notYetAdded.length} recurring
          </button>
        )}
      </div>

      {/* Today's tasks */}
      <div className="min-h-[40px] flex-1">
        {/* Meeting cards */}
        {sortedMaintMeetings.map(meeting => (
          <div
            key={meeting.id}
            className="flex items-center gap-3 py-2 group cursor-pointer hover:bg-canvas rounded-[6px] px-1 -mx-1 transition-colors"
            onClick={onOpenMeetings}
          >
            <Clock size={13} className="text-stone/40 flex-shrink-0" />
            <span className="text-[11px] text-stone/50 font-mono flex-shrink-0">{meeting.time}</span>
            <span className="text-[13px] text-charcoal flex-1 truncate">{meeting.title}</span>
            <span className="text-[11px] text-stone/40 flex-shrink-0">{meeting.durationMinutes}m</span>
            <button
              onClick={e => { e.stopPropagation(); removeMaintenanceMeeting(meeting.id) }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        {/* Selected projects */}
        {maintenanceProjectIds.map(projectId => {
          const project = projects.find(p => p.id === projectId)
          if (!project) return null
          return (
            <ProjectTaskPreview
              key={projectId}
              project={project}
              onRemove={() => removeMaintenanceProject(projectId)}
              previewCount={1}
            />
          )
        })}

        {/* Divider between projects and tasks when both present */}
        {maintenanceProjectIds.length > 0 && maintenanceTaskIds.length > 0 && (
          <div className="border-t border-border/30 my-1" />
        )}

        {/* Individual tasks */}
        {maintenanceTaskIds.map(taskId => {
          const task = findTaskById(taskId, [], orphanTasks, recurringTasks)?.task ?? null
          if (!task) return null
          const isDone = completedToday.has(taskId)
          return (
            <div key={taskId} className="flex items-center gap-3 py-1.5 group">
              <TaskCheckbox
                checked={isDone}
                onChange={() => handleToggle(taskId)}
                size="sm"
                color="var(--color-cat-admin)"
              />
              <span className={`text-[13px] flex-1 ${isDone ? 'text-stone/50 line-through' : 'text-charcoal'}`}>
                {task.title}
              </span>
              {task.taskType === 'reminder'
                ? <Bell size={10} className="text-teal-400 flex-shrink-0" />
                : task.isRecurring
                  ? <RotateCcw size={10} className="text-stone/25 flex-shrink-0" />
                  : null
              }
              {onEnterCitadel && (() => {
                const info = getFocusTimeLabel(taskId, inlineTimer, pomodoroLog)
                return (
                  <button
                    onClick={() => onEnterCitadel({ tier: 'maintenance', taskId, taskTitle: task.title })}
                    title="Start focus session"
                    className={`text-[10px] whitespace-nowrap transition-all flex-shrink-0 ${
                      info.isComplete
                        ? 'text-cat-marketing/60'
                        : info.isActive
                          ? 'text-cat-marketing font-medium'
                          : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone'
                    }`}
                  >
                    {info.label}
                  </button>
                )
              })()}
              <button
                onClick={() => removeMaintenanceTask(taskId)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
        {maintenanceProjectIds.length === 0 && slotsUsed === 0 && (
          <div className="text-[12px] text-stone/30 py-2 italic">
            The recurring work that keeps life running
          </div>
        )}
      </div>

      {/* Unchecked recurring tasks — not in plan, not done */}
      {uncheckedRecurring.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-stone/40 italic">
              {uncheckedRecurring.length} recurring task{uncheckedRecurring.length !== 1 ? 's' : ''} not yet done
            </span>
            <button
              onClick={handleAutoPopulate}
              className="text-[11px] text-stone/40 hover:text-stone transition-colors"
            >
              + add to plan
            </button>
          </div>
          <div className="mt-1.5 space-y-0.5">
            {uncheckedRecurring.map(t => (
              <div key={t.id} className="flex items-center gap-2">
                <RotateCcw size={10} className="text-stone/25 flex-shrink-0" />
                <span className="text-[12px] text-stone/40 truncate">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
