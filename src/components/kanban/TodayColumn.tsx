import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useStore } from '../../store'
import { useTaskToggle } from '../../hooks/useTaskToggle'
import { deriveItemOrder } from '../../lib/planOrder'
import type { TaskType } from '../../types'
import { SortableVandaagItem } from '../vandaag/SortableVandaagItem'

interface TodayColumnProps {
  onOpenMeetings: () => void
}

// Freely-orderable, single flat list — no rigid Deep/Short/Maintenance sections.
// Tier is still a per-item property (shown as a badge on each row, changeable via
// the row's tier badge or CardMenu, still capped: 1 deep, 3 short), but it no
// longer dictates position — items can be interleaved in any order the user wants
// (e.g. short, short, deep, maintenance, short).
export function TodayColumn({ onOpenMeetings }: TodayColumnProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const removeFromTodayPlan = useStore(s => s.removeFromTodayPlan)
  const changeTodayItemTier = useStore(s => s.changeTodayItemTier)
  const toggleTask = useTaskToggle()
  const { setNodeRef, isOver } = useDroppable({ id: 'today-all' })

  const items = dailyPlan ? (dailyPlan.itemOrder ?? deriveItemOrder(dailyPlan)) : []

  function handleTierChange(id: string, newTaskType: TaskType) {
    const tier = newTaskType === 'reminder' ? 'maintenance' : newTaskType
    const item = items.find(i => i.id === id)
    if (!item) return
    if (item.type === 'meeting') {
      // Known, accepted limitation: changeTodayItemTier only handles project/task —
      // meetings coexisting with a deep project (see deriveItemOrder) adds
      // eviction-rule complexity not worth building right now. Silent no-op.
      return
    }
    changeTodayItemTier(id, tier)
  }

  return (
    <div
      ref={setNodeRef}
      className={`bg-border-light/60 rounded-[10px] p-4 min-h-[300px] transition-colors ${isOver ? 'bg-border-light' : ''}`}
    >
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
        <span className="text-[13px] font-semibold text-stone tracking-[0.01em]">Today</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-border text-stone">{items.length}</span>
      </div>
      <SortableContext items={items.map(i => `plan-${i.id}`)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {items.map(item => (
            <SortableVandaagItem
              key={item.id}
              item={item}
              onOpenMeetings={onOpenMeetings}
              onRemove={removeFromTodayPlan}
              onTierChange={handleTierChange}
              toggleTask={toggleTask}
            />
          ))}
        </div>
        {items.length === 0 && (
          <div className="text-center text-stone/30 text-[11px] py-6 italic">Drag tasks here</div>
        )}
      </SortableContext>
    </div>
  )
}
