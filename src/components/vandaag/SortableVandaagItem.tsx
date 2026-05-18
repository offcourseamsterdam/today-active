import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Clock } from 'lucide-react'
import { useStore } from '../../store'
import { CATEGORY_CONFIG } from '../../types'
import type { PlanItem, TaskType } from '../../types'
import { findTaskById } from '../../lib/taskLookup'
import { TaskCheckbox } from '../ui/TaskCheckbox'
import { TierBadge } from '../planning/TierBadge'
import { MeetingInlineCard } from '../meetings/MeetingInlineCard'
import { useVandaagDark } from './VandaagDarkContext'

interface SortableVandaagItemProps {
  item: PlanItem
  onOpenMeetings?: () => void
  onRemove: (id: string) => void
  onTierChange: (id: string, newTaskType: TaskType) => void
  toggleTask: (taskId: string) => void
}

export function SortableVandaagItem({
  item, onOpenMeetings, onRemove, onTierChange, toggleTask,
}: SortableVandaagItemProps) {
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const meetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)
  const setOpenProjectId = useStore(s => s.setOpenProjectId)
  const completedItemIds = useStore(s => s.dailyPlan?.completedItemIds) ?? []
  const togglePlanItemCompletion = useStore(s => s.togglePlanItemCompletion)
  const dark = useVandaagDark()

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: `plan-${item.id}` })

  const style = { transform: CSS.Transform.toString(transform), transition }

  // Resolve item data
  const project = item.type === 'project' ? projects.find(p => p.id === item.id) : null
  const taskResult = item.type === 'task' ? findTaskById(item.id, projects, orphanTasks, recurringTasks) : null
  const allMeetings = [...meetings, ...recurringMeetings]
  const meeting = item.type === 'meeting' ? allMeetings.find(m => m.id === item.id) : null

  if (item.type === 'project' && !project) return null
  if (item.type === 'task' && !taskResult) return null
  if (item.type === 'meeting' && !meeting) return null

  const [meetingExpanded, setMeetingExpanded] = useState(false)

  const isDeep = item.tier === 'deep'
  const isItemCompleted = completedItemIds.includes(item.id)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`rounded-[8px] border transition-all duration-300 group
        ${isDragging ? 'shadow-lg scale-[1.02] z-10 opacity-80' : ''}
        ${dark
          ? 'bg-citadel-text/[0.03] border-citadel-text/8'
          : `bg-card border-border/50 ${isDeep ? 'border-charcoal/15' : ''}`
        }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Grip handle */}
        <div
          {...listeners}
          className={`cursor-grab active:cursor-grabbing transition-colors touch-none flex-shrink-0
            ${dark ? 'text-citadel-text/15 hover:text-citadel-text/30' : 'text-stone/25 hover:text-stone/50'}`}
        >
          <GripVertical size={14} />
        </div>

        {/* Tier badge — show taskType if set (e.g. reminder) */}
        <TierBadge
          tier={(item.type === 'task' ? taskResult?.task.taskType : undefined) ?? item.tier}
          itemType={item.type}
          onChange={(newTaskType) => onTierChange(item.id, newTaskType)}
        />

        {/* ── Project content ── */}
        {item.type === 'project' && project && (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <TaskCheckbox
              size="sm"
              checked={isItemCompleted}
              onChange={() => togglePlanItemCompletion(item.id)}
              color={CATEGORY_CONFIG[project.category].color}
            />
            {isDeep && project.coverImageUrl ? (
              <div className="w-8 h-8 rounded-[5px] overflow-hidden flex-shrink-0">
                <img src={project.coverImageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ background: CATEGORY_CONFIG[project.category].color }}
              />
            )}
            <button
              onClick={() => setOpenProjectId(project.id)}
              className="flex-1 min-w-0 text-left"
            >
              <span className={`truncate block ${isDeep ? 'text-[14px] font-medium' : 'text-[13px]'}
                ${isItemCompleted
                  ? dark ? 'text-citadel-text/25 line-through' : 'text-stone/40 line-through'
                  : dark ? 'text-citadel-text' : 'text-charcoal'}`}>
                {project.title}
              </span>
            </button>
          </div>
        )}

        {/* ── Task content ── */}
        {item.type === 'task' && taskResult && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <TaskCheckbox
              size="sm"
              checked={taskResult.task.status === 'done'}
              onChange={() => toggleTask(item.id)}
              color={taskResult.task.projectId
                ? `var(--color-cat-${projects.find(p => p.id === taskResult.task.projectId)?.category ?? 'personal'})`
                : undefined}
            />
            <span className={`text-[13px] flex-1 min-w-0 truncate
              ${taskResult.task.status === 'done'
                ? dark ? 'text-citadel-text/25 line-through' : 'text-stone/40 line-through'
                : dark ? 'text-citadel-text' : 'text-charcoal'}`}>
              {taskResult.task.title}
            </span>
            {taskResult.projectTitle && (
              <span className={`text-[10px] flex-shrink-0 truncate max-w-[100px] ${dark ? 'text-citadel-text/20' : 'text-stone/40'}`}>
                {taskResult.projectTitle}
              </span>
            )}
          </div>
        )}

        {/* ── Meeting content ── */}
        {item.type === 'meeting' && meeting && (
          <button
            onClick={() => setMeetingExpanded(prev => !prev)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <Clock size={12} className={dark ? 'text-citadel-text/30' : 'text-stone/50'} />
            <span className={`text-[11px] flex-shrink-0 ${dark ? 'text-citadel-text/30' : 'text-stone/50'}`}>{meeting.time}</span>
            <span className={`text-[13px] flex-1 min-w-0 truncate ${dark ? 'text-citadel-text' : 'text-charcoal'}`}>{meeting.title}</span>
            <span className={`text-[10px] flex-shrink-0 ${dark ? 'text-citadel-text/20' : 'text-stone/30'}`}>
              {meeting.durationMinutes < 60 ? `${meeting.durationMinutes}m` : `${meeting.durationMinutes / 60}h`}
            </span>
          </button>
        )}

        {/* Remove button */}
        <button
          onClick={() => onRemove(item.id)}
          className={`transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100
            ${dark ? 'text-citadel-text/15 hover:text-citadel-text/40' : 'text-stone/20 hover:text-stone/60'}`}
        >
          <X size={13} />
        </button>
      </div>

      {/* Expanded meeting inline card */}
      {item.type === 'meeting' && meeting && meetingExpanded && (
        <div className="px-3 pb-3">
          <MeetingInlineCard
            meeting={meeting}
            compact
            onBeginMeeting={onOpenMeetings}
          />
        </div>
      )}
    </div>
  )
}
