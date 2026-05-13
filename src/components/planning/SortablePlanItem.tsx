import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Clock } from 'lucide-react'
import { useStore } from '../../store'
import { CATEGORY_CONFIG } from '../../types'
import type { PlanItem, TaskType } from '../../types'
import { CategoryBadge } from '../ui/CategoryBadge'
import { findTaskById } from '../../lib/taskLookup'
import { TierBadge } from './TierBadge'

interface SortablePlanItemProps {
  item: PlanItem
  intention?: string
  onIntentionChange?: (v: string) => void
  onRemove: (id: string) => void
  onTierChange: (id: string, newTaskType: TaskType) => void
}

export function SortablePlanItem({ item, intention, onIntentionChange, onRemove, onTierChange }: SortablePlanItemProps) {
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const allMeetings = useStore(s => s.meetings)
  const recurringMeetingsList = useStore(s => s.recurringMeetings)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `plan-${item.id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Resolve item data
  const project = item.type === 'project' ? projects.find(p => p.id === item.id) : null
  const taskResult = item.type === 'task' ? findTaskById(item.id, projects, orphanTasks, recurringTasks) : null
  const allMeetingsList = [...allMeetings, ...recurringMeetingsList]
  const meeting = item.type === 'meeting' ? allMeetingsList.find(m => m.id === item.id) : null

  // Skip rendering if item can't be resolved
  if (item.type === 'project' && !project) return null
  if (item.type === 'task' && !taskResult) return null
  if (item.type === 'meeting' && !meeting) return null

  const isDeep = item.tier === 'deep'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`rounded-[10px] border bg-white transition-all duration-150
        ${isDragging ? 'shadow-lg scale-[1.02] z-10 opacity-80 border-[#2A2724]/30' : 'border-[#E8E4DD]'}
        ${isDeep ? 'border-[#2A2724]/20' : ''}
        animate-[scale-in_200ms_ease-out]`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 group">
        {/* Grip handle */}
        <div
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#7A746A]/30 hover:text-[#7A746A]/60
            transition-colors touch-none flex-shrink-0"
        >
          <GripVertical size={14} />
        </div>

        {/* Tier badge — show taskType if available (e.g. reminder), fall back to plan tier */}
        <TierBadge
          tier={(item.type === 'task' ? taskResult?.task.taskType : undefined) ?? item.tier}
          itemType={item.type}
          onChange={(newTaskType) => onTierChange(item.id, newTaskType)}
        />

        {/* Item content */}
        {item.type === 'project' && project && (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {isDeep && project.coverImageUrl ? (
              <div className="w-8 h-8 rounded-[5px] overflow-hidden flex-shrink-0">
                <img src={project.coverImageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            ) : isDeep ? (
              <div
                className="w-8 h-8 rounded-[5px] flex-shrink-0"
                style={{ background: CATEGORY_CONFIG[project.category].bg }}
              />
            ) : (
              <div className="w-1.5 h-1.5 rounded-sm bg-[#2A2724]/40 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-[#2A2724] truncate ${isDeep ? 'text-[14px] font-medium' : 'text-[13px]'}`}>
                {project.title}
              </div>
              {isDeep && (
                <div className="mt-0.5">
                  <CategoryBadge category={project.category} />
                </div>
              )}
            </div>
          </div>
        )}

        {item.type === 'task' && taskResult && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E8E4DD] flex-shrink-0" />
            <span className="text-[13px] text-[#2A2724] flex-1 min-w-0 truncate">
              {taskResult.task.title}
            </span>
            {taskResult.projectTitle && (
              <span className="text-[10px] text-[#7A746A]/50 flex-shrink-0">
                {taskResult.projectTitle}
              </span>
            )}
          </div>
        )}

        {item.type === 'meeting' && meeting && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Clock size={12} className="text-[#7A746A]/60 flex-shrink-0" />
            <span className="text-[13px] text-[#2A2724] flex-1 min-w-0 truncate">
              {meeting.title}
            </span>
            <span className="text-[10px] text-[#7A746A]/50 flex-shrink-0">
              {meeting.time} · {meeting.durationMinutes}m
            </span>
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={() => onRemove(item.id)}
          className="text-[#7A746A]/30 hover:text-[#7A746A] transition-colors flex-shrink-0
            opacity-0 group-hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>

      {/* Intention input for deep items */}
      {isDeep && onIntentionChange && (
        <div className="px-3 pb-3 pt-0">
          <label className="text-[11px] uppercase tracking-wider text-[#7A746A]/60 block mb-1.5">
            What do you want to accomplish?
          </label>
          <input
            type="text"
            value={intention ?? ''}
            onChange={e => onIntentionChange(e.target.value)}
            placeholder="e.g. Finish the landing page copy"
            className="w-full px-3 py-2 rounded-[8px] border border-[#E8E4DD] bg-[#FAF9F7]
              text-[13px] text-[#2A2724] placeholder:text-[#7A746A]/40
              outline-none focus:border-[#2A2724]/30 transition-colors"
          />
        </div>
      )}
    </div>
  )
}
