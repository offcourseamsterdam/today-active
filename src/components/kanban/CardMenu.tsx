import { Menu } from '@mantine/core'
import { MoreHorizontal, Pin, PinOff, Sunrise, CheckCircle2 } from 'lucide-react'
import { useStore } from '../../store'
import { findTaskById } from '../../lib/taskLookup'
import type { Tier } from '../../types'

interface CardMenuProps {
  id: string
  type: 'project' | 'task'
}

const TIER_LABELS: Record<Tier, string> = { deep: 'Deep Work', short: 'Short Task', maintenance: 'Maintenance' }

export function CardMenu({ id, type }: CardMenuProps) {
  const dailyPlan = useStore(s => s.dailyPlan)
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const addToTodayPlan = useStore(s => s.addToTodayPlan)
  const removeFromTodayPlan = useStore(s => s.removeFromTodayPlan)
  const togglePlanItemCompletion = useStore(s => s.togglePlanItemCompletion)
  const togglePlanItemPinned = useStore(s => s.togglePlanItemPinned)
  const addTomorrowShortTask = useStore(s => s.addTomorrowShortTask)
  const addTomorrowMaintenanceTask = useStore(s => s.addTomorrowMaintenanceTask)
  const addTomorrowShortProject = useStore(s => s.addTomorrowShortProject)
  const addTomorrowMaintenanceProject = useStore(s => s.addTomorrowMaintenanceProject)
  const setTomorrowDeepBlock = useStore(s => s.setTomorrowDeepBlock)
  const moveProject = useStore(s => s.moveProject)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const updateTask = useStore(s => s.updateTask)

  const itemOrder = dailyPlan?.itemOrder ?? []
  const planItem = itemOrder.find(i => i.id === id)
  const inToday = !!planItem
  const isPinned = (dailyPlan?.pinnedItemIds ?? []).includes(id)
  const isFinishedForToday = (dailyPlan?.completedItemIds ?? []).includes(id)

  function snoozeToTomorrow() {
    const tier = planItem?.tier ?? 'maintenance'
    if (inToday) removeFromTodayPlan(id)
    if (type === 'project') {
      if (tier === 'deep') setTomorrowDeepBlock(id)
      else if (tier === 'short') addTomorrowShortProject(id)
      else addTomorrowMaintenanceProject(id)
    } else {
      if (tier === 'short') addTomorrowShortTask(id)
      else addTomorrowMaintenanceTask(id)
    }
  }

  function markFinished() {
    if (type === 'project') {
      moveProject(id, 'done')
      return
    }
    const result = findTaskById(id, projects, orphanTasks, recurringTasks)
    if (!result) return
    if (result.task.projectId) {
      updateTask(id, result.task.projectId, { status: 'done', completedAt: new Date().toISOString() })
    } else {
      updateOrphanTask(id, { status: 'done', completedAt: new Date().toISOString() })
    }
  }

  return (
    <Menu shadow="md" width={220} position="bottom-end">
      <Menu.Target>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
      </Menu.Target>
      <Menu.Dropdown onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        {!inToday && (
          <Menu.Sub>
            <Menu.Sub.Target>
              <Menu.Sub.Item>Add to Today</Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown>
              {(type === 'project' ? (['deep', 'short', 'maintenance'] as const) : (['short', 'maintenance'] as const))
                .map(tier => (
                  <Menu.Item key={tier} onClick={() => addToTodayPlan(id, type, tier)}>
                    {TIER_LABELS[tier]}
                  </Menu.Item>
                ))}
            </Menu.Sub.Dropdown>
          </Menu.Sub>
        )}

        {inToday && (
          <>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item>Change tier</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {(type === 'project' ? (['deep', 'short', 'maintenance'] as const) : (['short', 'maintenance'] as const))
                  .filter(tier => tier !== planItem!.tier)
                  .map(tier => (
                    <Menu.Item key={tier} onClick={() => { removeFromTodayPlan(id); addToTodayPlan(id, type, tier) }}>
                      {TIER_LABELS[tier]}
                    </Menu.Item>
                  ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            <Menu.Item onClick={() => removeFromTodayPlan(id)}>Remove from Today</Menu.Item>
            {type === 'project' && (
              <Menu.Item
                leftSection={<CheckCircle2 size={13} />}
                onClick={() => togglePlanItemCompletion(id)}
              >
                {isFinishedForToday ? "Undo finish for today" : "Finish for today"}
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={isPinned ? <PinOff size={13} /> : <Pin size={13} />}
              onClick={() => togglePlanItemPinned(id)}
            >
              {isPinned ? 'Unpin from Today' : 'Pin to Today'}
            </Menu.Item>
          </>
        )}

        <Menu.Item leftSection={<Sunrise size={13} />} onClick={snoozeToTomorrow}>
          Snooze to tomorrow
        </Menu.Item>

        <Menu.Divider />
        <Menu.Item onClick={markFinished}>
          {type === 'project' ? 'Mark project finished' : 'Mark task done'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
