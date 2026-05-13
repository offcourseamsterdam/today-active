import { useState, useEffect, useMemo } from 'react'
import { format, addDays } from 'date-fns'
import { X, Plus, RotateCcw, AlertTriangle } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  pointerWithin,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { useStore } from '../../store'
import { getTodayString, getTomorrowString } from '../../store/helpers'
import { useTomorrowPlan } from '../../hooks/useTomorrowPlan'
import { useTodayPlan } from '../../hooks/useTodayPlan'
import { findTaskById } from '../../lib/taskLookup'
import { deriveItemOrder, deriveBlockOrder } from '../../lib/planOrder'
import type { Project, Meeting, PlanItem, TaskType } from '../../types'
import { InventoryPanel } from './InventoryPanel'
import { PlanningDragOverlay } from './PlanningDragOverlay'
import { SortablePlanItem } from './SortablePlanItem'
import { WaitingFollowUpPanel } from './WaitingFollowUpPanel'

interface PlanningModalProps {
  onClose: () => void
  day?: 'today' | 'tomorrow'
}

const collisionStrategy: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length > 0) return within
  return closestCorners(args)
}

// ─── Drop zone for the plan list ────────────────────────────────
function PlanDropZone({ children, isEmpty, isOver }: { children: React.ReactNode; isEmpty: boolean; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'plan-list' })

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 min-h-[120px] rounded-[12px] transition-all duration-150
        ${isOver ? 'bg-[#FAF9F7] ring-2 ring-[#2A2724]/10' : ''}
        ${isEmpty && !isOver ? 'border-2 border-dashed border-[#E8E4DD] flex items-center justify-center' : ''}`}
    >
      {isEmpty && !isOver ? (
        <div className="text-[12px] text-[#7A746A]/40 italic py-8">
          Drag items here to plan your day
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export function PlanningModal({ onClose, day = 'tomorrow' }: PlanningModalProps) {
  // ─── Store ─────────────────────────────────────────────────────
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)
  const meetings = useStore(s => s.meetings)
  const recurringMeetingsList = useStore(s => s.recurringMeetings)
  const addOrphanTask = useStore(s => s.addOrphanTask)
  const updateOrphanTask = useStore(s => s.updateOrphanTask)
  const updateRecurringTask = useStore(s => s.updateRecurringTask)
  const moveOrphanTaskToProject = useStore(s => s.moveOrphanTaskToProject)
  const getTodayRecurringTasks = useStore(s => s.getTodayRecurringTasks)
  const getTomorrowRecurringTasks = useStore(s => s.getTomorrowRecurringTasks)

  const { tomorrowPlan } = useTomorrowPlan()
  const { dailyPlan } = useTodayPlan()

  const isToday = day === 'today'
  const activePlan = isToday ? dailyPlan : tomorrowPlan

  // ─── Local State ───────────────────────────────────────────────
  const [orderedItems, setOrderedItems] = useState<PlanItem[]>([])
  const [intention, setIntention] = useState('')
  const [showMobileInventory, setShowMobileInventory] = useState(false)
  const [quickAdd, setQuickAdd] = useState('')
  const [quickAddTier, setQuickAddTier] = useState<TaskType>('maintenance')
  const [lastAddedId, setLastAddedId] = useState<string | null>(null)

  // Overdue recurring detection
  const todayRecurring = getTodayRecurringTasks()
  const planDayRecurring = day === 'tomorrow' ? getTomorrowRecurringTasks() : todayRecurring
  const today = getTodayString()
  const overdueRecurring = todayRecurring.filter(t => t.lastCompletedDate !== today)

  const assignedIds = useMemo(() => new Set(orderedItems.map(i => i.id)), [orderedItems])
  const overdueNotAdded = overdueRecurring.filter(t => !assignedIds.has(t.id))
  const recurringNotAdded = planDayRecurring.filter(t => !assignedIds.has(t.id))

  // Pre-populate from existing plan on mount
  useEffect(() => {
    if (!activePlan) return
    const expectedDate = isToday ? getTodayString() : getTomorrowString()
    if (activePlan.date !== expectedDate) return

    // Use itemOrder if available, otherwise derive from tier arrays
    const items = activePlan.itemOrder ?? deriveItemOrder(activePlan)
    setOrderedItems(items)
    setIntention(activePlan.deepBlock.intention || '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── DnD State ─────────────────────────────────────────────────
  const [activeType, setActiveType] = useState<'project' | 'task' | 'meeting' | null>(null)
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [activeTask, setActiveTask] = useState<{ task: any; projectTitle?: string } | null>(null)
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null)
  const [isOverPlanList, setIsOverPlanList] = useState(false)

  const allMeetingsList = useMemo(() => [...meetings, ...recurringMeetingsList], [meetings, recurringMeetingsList])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const dateLabel = isToday
    ? format(new Date(), 'EEEE d MMMM')
    : format(addDays(new Date(), 1), 'EEEE d MMMM')

  // ─── Computed ──────────────────────────────────────────────────
  const allAssignedIds = useMemo(() => {
    return new Set(orderedItems.map(i => i.id))
  }, [orderedItems])

  const deepCount = useMemo(() => orderedItems.filter(i => i.tier === 'deep').length, [orderedItems])
  const shortSlots = useMemo(() => orderedItems
    .filter(i => i.tier === 'short')
    .reduce((sum, i) => {
      if (i.type === 'meeting') {
        const m = allMeetingsList.find(x => x.id === i.id)
        return sum + (m ? Math.ceil(m.durationMinutes / 60) : 1)
      }
      return sum + 1
    }, 0), [orderedItems, allMeetingsList])

  // ─── Helpers ───────────────────────────────────────────────────
  function autoAssignTier(type: 'project' | 'task' | 'meeting'): 'deep' | 'short' | 'maintenance' {
    if (type === 'project' && deepCount === 0) return 'deep'
    if (type === 'task') return shortSlots < 3 ? 'short' : 'maintenance'
    if (type === 'meeting') return shortSlots < 3 ? 'short' : 'maintenance'
    return shortSlots < 3 ? 'short' : 'maintenance'
  }

  function handleTierChange(id: string, newTaskType: TaskType) {
    // 'reminder' stays in maintenance tier for plan-slot purposes
    const planTier: 'deep' | 'short' | 'maintenance' = newTaskType === 'reminder' ? 'maintenance' : newTaskType

    setOrderedItems(prev => {
      if (planTier === 'deep') {
        const item = prev.find(i => i.id === id)
        if (item?.type === 'task') return prev // Tasks can't be deep
        if (prev.filter(i => i.tier === 'deep' && i.id !== id).length >= 1) return prev
      }
      if (planTier === 'short') {
        const currentShort = prev.filter(i => i.tier === 'short' && i.id !== id)
        const usedSlots = currentShort.reduce((sum, i) => {
          if (i.type === 'meeting') {
            const m = allMeetingsList.find(x => x.id === i.id)
            return sum + (m ? Math.ceil(m.durationMinutes / 60) : 1)
          }
          return sum + 1
        }, 0)
        if (usedSlots >= 3) return prev
      }
      return prev.map(i => i.id === id ? { ...i, tier: planTier } : i)
    })

    // Persist taskType back to the task record at the source of truth
    const isRecurring = recurringTasks.some(t => t.id === id)
    const isOrphan = orphanTasks.some(t => t.id === id)
    const projectTask = !isRecurring && !isOrphan
      ? (() => {
          for (const p of projects) {
            if (p.tasks.some(t => t.id === id)) return true
          }
          return false
        })()
      : false

    if (isRecurring) {
      updateRecurringTask(id, { taskType: newTaskType })
    } else if (isOrphan) {
      updateOrphanTask(id, { taskType: newTaskType })
    } else if (projectTask) {
      // Project tasks: update via project tasks array
      useStore.setState(s => ({
        projects: s.projects.map(p => ({
          ...p,
          tasks: p.tasks.map(t => t.id === id ? { ...t, taskType: newTaskType } : t),
        })),
      }))
    }
  }

  // ─── DnD Handlers ─────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    const data = active.data.current as { type: 'project' | 'task' | 'meeting'; id: string } | undefined
    if (!data) return

    setActiveType(data.type)
    if (data.type === 'project') {
      setActiveProject(projects.find(p => p.id === data.id) ?? null)
    } else if (data.type === 'task') {
      setActiveTask(findTaskById(data.id, projects, orphanTasks, recurringTasks))
    } else if (data.type === 'meeting') {
      setActiveMeeting(allMeetingsList.find(m => m.id === data.id) ?? null)
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as string | undefined
    setIsOverPlanList(overId === 'plan-list' || (overId?.startsWith('plan-') ?? false))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveType(null)
    setActiveProject(null)
    setActiveTask(null)
    setActiveMeeting(null)
    setIsOverPlanList(false)

    if (!over) return

    const activeIdStr = active.id as string
    const overIdStr = over.id as string

    // ─── Reorder within list ───
    if (activeIdStr.startsWith('plan-') && overIdStr.startsWith('plan-')) {
      const sortableIds = orderedItems.map(i => `plan-${i.id}`)
      const oldIndex = sortableIds.indexOf(activeIdStr)
      const newIndex = sortableIds.indexOf(overIdStr)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setOrderedItems(prev => arrayMove(prev, oldIndex, newIndex))
      }
      return
    }

    // ─── Drop from inventory onto plan list ───
    const data = active.data.current as { type: 'project' | 'task' | 'meeting'; id: string } | undefined
    if (!data) return

    const { type, id } = data

    // If dropped on plan-list or any plan-item, add to list
    if (overIdStr === 'plan-list' || overIdStr.startsWith('plan-')) {
      // Already in list? Skip
      if (orderedItems.some(i => i.id === id)) return

      const tier = autoAssignTier(type)
      const newItem: PlanItem = { id, type, tier }

      // If dropped on a specific item, insert after it
      if (overIdStr.startsWith('plan-') && overIdStr !== 'plan-list') {
        const targetId = overIdStr.replace('plan-', '')
        const targetIndex = orderedItems.findIndex(i => i.id === targetId)
        if (targetIndex !== -1) {
          setOrderedItems(prev => {
            const next = [...prev]
            next.splice(targetIndex + 1, 0, newItem)
            return next
          })
          return
        }
      }

      // Append to end
      setOrderedItems(prev => [...prev, newItem])
      return
    }

    // If dropped back on inventory — remove from list
    if (overIdStr === 'inventory' || overIdStr.startsWith('inventory')) {
      setOrderedItems(prev => prev.filter(i => i.id !== id))
    }
  }

  function handleRemoveItem(id: string) {
    setOrderedItems(prev => prev.filter(i => i.id !== id))
  }

  // ─── Maintenance helpers ──────────────────────────────────────
  function handleAutoPopulateRecurring() {
    const newItems: PlanItem[] = recurringNotAdded.map(t => ({
      id: t.id,
      type: 'task' as const,
      tier: 'maintenance' as const,
    }))
    setOrderedItems(prev => [...prev, ...newItems])
  }

  function handleCarryOverOverdue() {
    const newItems: PlanItem[] = overdueNotAdded.map(t => ({
      id: t.id,
      type: 'task' as const,
      tier: 'maintenance' as const,
    }))
    setOrderedItems(prev => [...prev, ...newItems])
  }

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!quickAdd.trim()) return
    const planTier: 'deep' | 'short' | 'maintenance' = quickAddTier === 'reminder' ? 'maintenance' : quickAddTier
    const id = addOrphanTask(quickAdd.trim())
    updateOrphanTask(id, { taskType: quickAddTier })
    setOrderedItems(prev => [...prev, { id, type: 'task', tier: planTier }])
    setLastAddedId(id)
    setQuickAdd('')
  }

  function handleAssignProject(projectId: string) {
    if (!lastAddedId) return
    moveOrphanTaskToProject(lastAddedId, projectId)
    setLastAddedId(null)
  }

  const FOCUS_QUOTES = [
    { text: 'Finish what you start.', author: null },
    { text: 'Do one thing at a time, and do that one thing as if your life depended on it.', author: 'Eugene Grace' },
    { text: 'You can do anything, but not everything.', author: 'David Allen' },
    { text: 'The key is not to prioritize what\'s on your schedule, but to schedule your priorities.', author: 'Stephen Covey' },
    { text: 'It\'s not enough to be busy — the question is, what are we busy about?', author: 'Thoreau' },
  ]
  const focusQuote = FOCUS_QUOTES[new Date().getDay() % FOCUS_QUOTES.length]

  // ─── Lock In ──────────────────────────────────────────────────
  const lockInPlan = useStore(s => s.lockInPlan)

  function handleLockIn() {
    const deepProject = orderedItems.find(i => i.tier === 'deep' && i.type === 'project')
    const deepMeeting = orderedItems.find(i => i.tier === 'deep' && i.type === 'meeting')
    const blockOrder = deriveBlockOrder(orderedItems)

    lockInPlan(isToday ? 'today' : 'tomorrow', {
      deepProjectId: deepProject?.id ?? '',
      intention: intention || undefined,
      deepMeetingId: deepMeeting?.id,
      shortTasks: orderedItems.filter(i => i.tier === 'short' && i.type === 'task').map(i => i.id),
      shortProjects: orderedItems.filter(i => i.tier === 'short' && i.type === 'project').map(i => i.id),
      shortMeetingIds: orderedItems.filter(i => i.tier === 'short' && i.type === 'meeting').map(i => i.id),
      maintenanceTasks: orderedItems.filter(i => i.tier === 'maintenance' && i.type === 'task').map(i => i.id),
      maintenanceProjects: orderedItems.filter(i => i.tier === 'maintenance' && i.type === 'project').map(i => i.id),
      maintenanceMeetingIds: orderedItems.filter(i => i.tier === 'maintenance' && i.type === 'meeting').map(i => i.id),
      blockOrder,
      itemOrder: orderedItems,
    })

    onClose()
  }

  // ─── Render ────────────────────────────────────────────────────
  const sortableIds = orderedItems.map(i => `plan-${i.id}`)
  const hasOverdue = overdueNotAdded.length > 0
  const isEmpty = orderedItems.length === 0

  return (
    <div className="fixed inset-0 z-50 bg-[#FAF9F7] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 sm:px-8 py-4 border-b border-[#E8E4DD] bg-white flex-shrink-0">
        <span className="font-serif text-[18px] text-[#2A2724]">
          {isToday ? 'Plan today' : 'Plan tomorrow'}
        </span>
        <span className="text-[13px] text-[#7A746A] hidden sm:block absolute left-1/2 -translate-x-1/2">
          {dateLabel.toLowerCase()}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleLockIn}
            className="flex items-center gap-2 px-5 py-2 rounded-[8px]
              bg-[#2A2724] text-white text-[13px] font-medium
              hover:bg-[#2A2724]/90 transition-all"
          >
            {isToday ? 'Lock in today' : 'Lock in tomorrow'}
          </button>
          <button
            onClick={onClose}
            className="text-[#7A746A]/50 hover:text-[#7A746A] transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionStrategy}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Left column — flat plan list */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-[640px] mx-auto space-y-4">
              <WaitingFollowUpPanel />

              {/* Slot indicators */}
              <div className="flex items-center gap-4 text-[11px] text-[#7A746A]/60">
                <span className={deepCount >= 1 ? 'text-indigo-500' : ''}>
                  Deep: {deepCount}/1
                </span>
                <span className={shortSlots >= 3 ? 'text-amber-500' : ''}>
                  Short: {shortSlots}/3
                </span>
                <span>Maintenance: {orderedItems.filter(i => i.tier === 'maintenance').length}</span>
              </div>

              {/* Overdue recurring banner */}
              {hasOverdue && (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-amber-800">
                          {overdueNotAdded.length} recurring task{overdueNotAdded.length !== 1 ? 's' : ''} not done today
                        </div>
                        <div className="text-[11px] text-amber-600/80 mt-0.5">
                          Carry them over to get back on track.
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleCarryOverOverdue}
                      className="text-[11px] text-amber-700 border border-amber-300 rounded px-2 py-1
                        hover:bg-amber-100 transition-colors whitespace-nowrap flex-shrink-0"
                    >
                      Carry all over
                    </button>
                  </div>
                </div>
              )}

              {/* Auto-populate recurring */}
              {recurringNotAdded.length > 0 && (
                <button
                  onClick={handleAutoPopulateRecurring}
                  className="flex items-center gap-1.5 text-[11px] text-[#7A746A]
                    px-2.5 py-1.5 rounded border border-[#E8E4DD]
                    hover:border-[#7A746A]/30 hover:text-[#2A2724] transition-all w-full justify-center"
                >
                  <RotateCcw size={11} />
                  Add {recurringNotAdded.length} {day === 'tomorrow' ? "tomorrow's" : "today's"} recurring
                </button>
              )}

              {/* Sortable plan list */}
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <PlanDropZone isEmpty={isEmpty} isOver={isOverPlanList}>
                  {orderedItems.map(item => (
                    <SortablePlanItem
                      key={item.id}
                      item={item}
                      intention={item.tier === 'deep' ? intention : undefined}
                      onIntentionChange={item.tier === 'deep' ? setIntention : undefined}
                      onRemove={handleRemoveItem}
                      onTierChange={handleTierChange}
                    />
                  ))}
                </PlanDropZone>
              </SortableContext>

              {/* Quick-add task */}
              <div className="space-y-2">
                <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={quickAdd}
                    onChange={e => { setQuickAdd(e.target.value); setLastAddedId(null) }}
                    placeholder="Add a task..."
                    className="flex-1 px-3 py-2 rounded-[6px] border border-[#E8E4DD] bg-[#FAF9F7]
                      text-[12px] text-[#2A2724] placeholder:text-[#7A746A]/40
                      outline-none focus:border-[#2A2724]/30 transition-colors"
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(['maintenance', 'short', 'deep', 'reminder'] as const).map(tier => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setQuickAddTier(tier)}
                        className={`px-2 py-1.5 rounded-[5px] text-[10px] uppercase tracking-wide font-medium transition-all
                          ${quickAddTier === tier
                            ? tier === 'reminder'
                              ? 'bg-teal-600 text-white'
                              : 'bg-[#2A2724] text-white'
                            : 'border border-[#E8E4DD] text-[#7A746A]/60 hover:border-[#2A2724]/30 hover:text-[#2A2724]'
                          }`}
                      >
                        {tier === 'maintenance' ? 'M' : tier === 'short' ? 'S' : tier === 'deep' ? 'D' : 'R'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={!quickAdd.trim()}
                    className="px-3 py-2 rounded-[6px] border border-[#E8E4DD]
                      text-[12px] text-[#7A746A] hover:border-[#2A2724]/30 hover:text-[#2A2724]
                      transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </form>

                {/* Assign to project after adding */}
                {lastAddedId && (
                  <div className="flex items-center gap-2 pl-1 animate-[fadeUpIn_150ms_ease-out]">
                    <span className="text-[11px] text-[#7A746A]/50">Assign to project:</span>
                    <div className="flex flex-wrap gap-1">
                      {projects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleAssignProject(p.id)}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-[#E8E4DD]
                            text-[#7A746A] hover:border-[#2A2724]/30 hover:text-[#2A2724] transition-all"
                        >
                          {p.title}
                        </button>
                      ))}
                      <button
                        onClick={() => setLastAddedId(null)}
                        className="text-[10px] px-2 py-0.5 text-[#7A746A]/40 hover:text-[#7A746A] transition-colors"
                      >
                        skip
                      </button>
                    </div>
                  </div>
                )}

                {/* Focus quote */}
                <p className="text-[10px] italic text-[#7A746A]/35 px-1 pt-1">
                  &ldquo;{focusQuote.text}&rdquo;{focusQuote.author && <> — {focusQuote.author}</>}
                </p>
              </div>
            </div>
          </div>

          {/* Right column — inventory (desktop) */}
          <div className="hidden sm:block w-[340px] border-l border-[#E8E4DD] px-5 py-6 overflow-y-auto flex-shrink-0">
            <InventoryPanel allAssignedIds={allAssignedIds} day={day} />
          </div>

          {/* Mobile FAB */}
          <button
            onClick={() => setShowMobileInventory(true)}
            className="sm:hidden fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[#2A2724] text-white
              shadow-lg flex items-center justify-center z-10
              hover:bg-[#2A2724]/90 active:scale-95 transition-all"
          >
            <Plus size={24} />
          </button>

          {/* Mobile bottom sheet */}
          {showMobileInventory && (
            <div className="sm:hidden fixed inset-0 z-20">
              <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={() => setShowMobileInventory(false)}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-[#FAF9F7] rounded-t-2xl shadow-xl
                max-h-[60vh] flex flex-col animate-[slide-up_200ms_ease-out]">
                {/* Sheet handle */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="w-10 h-1 rounded-full bg-[#E8E4DD]" />
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-6">
                  <InventoryPanel allAssignedIds={allAssignedIds} day={day} />
                </div>
                {/* Mobile lock-in */}
                <div className="p-4 border-t border-[#E8E4DD]">
                  <button
                    onClick={handleLockIn}
                    className="w-full py-3 rounded-[8px] bg-[#2A2724] text-white text-[13px] font-medium
                      hover:bg-[#2A2724]/90 transition-all"
                  >
                    {isToday ? 'Lock in today' : 'Lock in tomorrow'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Drag Overlay */}
          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease-out' }}>
            <PlanningDragOverlay
              activeType={activeType}
              project={activeProject}
              task={activeTask}
              meeting={activeMeeting}
            />
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}
