import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useStore } from '../../store'
import { useTaskToggle } from '../../hooks/useTaskToggle'
import { deriveItemOrder } from '../../lib/planOrder'
import type { Tier, PlanItem, TaskType } from '../../types'
import { SortableVandaagItem } from '../vandaag/SortableVandaagItem'
import { TierSectionHeader } from '../vandaag/TierSectionHeader'

const TIER_ORDER: Tier[] = ['deep', 'short', 'maintenance']
const TIER_SLOT_MAX: Record<Tier, number | undefined> = { deep: 1, short: 3, maintenance: undefined }

function TierDropZone({ tier, items, onOpenMeetings, onTierChange, onRemove, toggleTask }: {
  tier: Tier
  items: PlanItem[]
  onOpenMeetings: () => void
  onTierChange: (id: string, t: TaskType) => void
  onRemove: (id: string) => void
  toggleTask: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `today-${tier}` })
  const meetings = useStore(s => s.meetings)
  const recurringMeetings = useStore(s => s.recurringMeetings)

  const slotCount = items.reduce((sum, i) => {
    if (i.type === 'meeting') {
      const m = [...meetings, ...recurringMeetings].find(m => m.id === i.id)
      return sum + Math.ceil((m?.durationMinutes ?? 60) / 60)
    }
    return sum + 1
  }, 0)

  // No SortableContext here — a single one wraps the whole column (see TodayColumn
  // below). Splitting it per tier used to cause dnd-kit's multi-container sortable
  // issue (an item briefly registers in two SortableContexts while being dragged
  // across a tier boundary, which can render it twice). One shared context avoids
  // that and also matches items.map()'s render order below.
  return (
    <div ref={setNodeRef} className={`rounded-[8px] p-1.5 transition-colors ${isOver ? 'bg-border-light' : ''}`}>
      <TierSectionHeader tier={tier} slotCount={slotCount} slotMax={TIER_SLOT_MAX[tier]} />
      <div className="space-y-1.5">
        {items.map(item => (
          <SortableVandaagItem
            key={item.id}
            item={item}
            onOpenMeetings={onOpenMeetings}
            onRemove={onRemove}
            onTierChange={onTierChange}
            toggleTask={toggleTask}
          />
        ))}
      </div>
      {items.length === 0 && (
        <div className="text-center text-stone/30 text-[11px] py-3 italic">Drop here</div>
      )}
    </div>
  )
}

interface TodayColumnProps {
  onOpenMeetings: () => void
}

export function TodayColumn({ onOpenMeetings }: TodayColumnProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const removeFromTodayPlan = useStore(s => s.removeFromTodayPlan)
  const changeTodayItemTier = useStore(s => s.changeTodayItemTier)
  const toggleTask = useTaskToggle()

  const rawItems = dailyPlan ? (dailyPlan.itemOrder ?? deriveItemOrder(dailyPlan)) : []
  const byTier = (t: Tier) => rawItems.filter(i => i.tier === t)
  // Display/sortable order must match actual DOM order (grouped by tier), not raw
  // itemOrder (which can interleave tiers as items get added over time) — dnd-kit's
  // sorting strategy assumes the items list order matches render order.
  const items = TIER_ORDER.flatMap(byTier)

  function handleTierChange(id: string, newTaskType: TaskType) {
    const tier: Tier = newTaskType === 'reminder' ? 'maintenance' : newTaskType
    const item = items.find(i => i.id === id)
    if (!item) return
    if (item.type === 'meeting') {
      // INTENTIONAL, ACCEPTED LIMITATION (a controller-level scope decision, not an
      // oversight for you to fix): changeTodayItemTier only handles project/task.
      // Meetings coexisting with a deep project in the deep tier (see deriveItemOrder)
      // adds eviction-rule complexity specific to meetings that isn't worth building
      // right now. Changing a meeting's tier from the Today column is currently
      // unimplemented — this is a silent no-op, and there is no other working UI path
      // for it anymore (the old DailyPlanList.tsx, which used to handle this, was
      // deleted). This is a known permanent gap, not a temporary one.
      return
    }
    changeTodayItemTier(id, tier)
  }

  return (
    <div className="bg-border-light/60 rounded-[10px] p-4 min-h-[300px]">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
        <span className="text-[13px] font-semibold text-stone tracking-[0.01em]">Today</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-border text-stone">{items.length}</span>
      </div>
      <SortableContext items={items.map(i => `plan-${i.id}`)} strategy={verticalListSortingStrategy}>
        {TIER_ORDER.map(tier => (
          <TierDropZone
            key={tier}
            tier={tier}
            items={byTier(tier)}
            onOpenMeetings={onOpenMeetings}
            onTierChange={handleTierChange}
            onRemove={removeFromTodayPlan}
            toggleTask={toggleTask}
          />
        ))}
      </SortableContext>
    </div>
  )
}
