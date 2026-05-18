import { useMemo } from 'react'
import { Check, Clock, X } from 'lucide-react'
import { useStore } from '../../store'
import { findTaskById } from '../../lib/taskLookup'
import { findMeetingById } from '../../lib/meetingLookup'
import { useTodayPlan } from '../../hooks/useTodayPlan'
import { useTaskToggle } from '../../hooks/useTaskToggle'
import { ProjectTaskPreview } from '../ui/ProjectTaskPreview'
import { TaskItem } from '../ui/TaskItem'

interface ShortTasksProps {
  onOpenMeetings?: () => void
}

export function ShortTasks({ onOpenMeetings }: ShortTasksProps) {
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const moveOrphanTaskToProject = useStore(s => s.moveOrphanTaskToProject)
  const setOpenProjectId = useStore(s => s.setOpenProjectId)
  const allMeetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)
  const {
    shortTaskIds, removeShortTask,
    shortProjectIds, removeShortProject,
    shortMeetingIds, removeShortMeeting,
  } = useTodayPlan()
  const showToast = useStore(s => s.showToast)
  const toggleTask = useTaskToggle(showToast)


  // Resolve short meeting IDs to objects, sorted by time
  const sortedShortMeetings = useMemo(() => {
    return shortMeetingIds
      .map(id => findMeetingById(id, allMeetings, recurringMeetings))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [shortMeetingIds, allMeetings, recurringMeetings])

  const meetingSlots = (durationMinutes: number) => Math.ceil(durationMinutes / 60)
  const slotsUsed = shortTaskIds.length + shortProjectIds.length +
    sortedShortMeetings.reduce((sum, m) => sum + meetingSlots(m.durationMinutes), 0)

  return (
    <div className="bg-card rounded-[10px] p-5 shadow-card border border-border/50">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-cat-ops" />
          <span className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium">
            Short three
          </span>
          <span className="text-[11px] text-stone/50">{slotsUsed}/3</span>
        </div>
      </div>

      {/* Content list */}
      <div className="min-h-[60px]">
        {/* Meeting cards from plan assignment */}
        {sortedShortMeetings.map(meeting => {
          const slots = meetingSlots(meeting.durationMinutes)
          const isMultiSlot = slots > 1
          return (
            <div
              key={meeting.id}
              className={`flex items-center gap-3 group cursor-pointer hover:bg-canvas/50 -mx-1 px-1 rounded-[4px] transition-colors
                ${isMultiSlot ? 'py-3 border-l-2 border-cat-marketing/30 pl-2' : 'py-2'}`}
              onClick={onOpenMeetings}
            >
              <Clock size={13} className="text-cat-marketing flex-shrink-0" />
              <span className="text-[10px] font-medium text-cat-marketing bg-cat-marketing/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                {meeting.time}
              </span>
              <span className="text-[13px] text-charcoal flex-1 min-w-0 truncate">
                {meeting.title}
              </span>
              <span className="text-[10px] text-stone/40 flex-shrink-0">
                {meeting.durationMinutes}m{isMultiSlot ? ` · ${slots} slots` : ''}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeShortMeeting(meeting.id) }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}

        {/* Divider between meetings and projects/tasks */}
        {sortedShortMeetings.length > 0 && (shortProjectIds.length > 0 || shortTaskIds.length > 0) && (
          <div className="border-t border-border/30 my-1" />
        )}

        {/* Selected projects */}
        {shortProjectIds.map(projectId => {
          const project = projects.find(p => p.id === projectId)
          if (!project) return null
          return (
            <ProjectTaskPreview
              key={projectId}
              project={project}
              onRemove={() => removeShortProject(projectId)}
            />
          )
        })}

        {/* Divider between projects and tasks when both present */}
        {shortProjectIds.length > 0 && shortTaskIds.length > 0 && (
          <div className="border-t border-border/30 my-1" />
        )}

        {/* Individual tasks */}
        {shortTaskIds.map(taskId => {
          const found = findTaskById(taskId, projects, orphanTasks)
          if (!found) return null
          return (
            <div key={taskId} className="flex items-center gap-3 py-2 group relative">
              <TaskItem
                task={found.task}
                projectTitle={found.projectTitle}
                projects={projects}
                onToggle={() => toggleTask(taskId)}
                onRemove={() => removeShortTask(taskId)}
                onAssignProject={(projectId) => moveOrphanTaskToProject(taskId, projectId)}
                onOpenProject={setOpenProjectId}
              />
            </div>
          )
        })}

        {shortProjectIds.length === 0 && slotsUsed === 0 && (
          <div className="text-[13px] text-stone/30 py-3 text-center italic">
            Especially the ones you've been putting off
          </div>
        )}
      </div>

    </div>
  )
}
