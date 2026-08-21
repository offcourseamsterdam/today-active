import { useState, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { startOfWeek, addDays, format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, Plus } from 'lucide-react'
import { useStore } from '../../store'
import { isGoalActive } from '../../lib/goals'
import type { Goal } from '../../types'
import { WeekDayColumn } from './WeekDayColumn'
import { WeekProjectSidebar } from './WeekProjectSidebar'
import { GoalChip } from './GoalChip'
import { GoalForm } from './GoalForm'

export function WeekPlannerView() {
  const projects = useStore(s => s.projects)
  const weekSlots = useStore(s => s.weekSlots)
  const planHistory = useStore(s => s.planHistory)
  const dailyPlan = useStore(s => s.dailyPlan)
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const goals = useStore(s => s.goals)
  const addProjectToSlot = useStore(s => s.addProjectToSlot)
  const removeProjectFromSlot = useStore(s => s.removeProjectFromSlot)
  const setWeekSlot = useStore(s => s.setWeekSlot)
  const assignProjectToGoal = useStore(s => s.assignProjectToGoal)

  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [showPastGoals, setShowPastGoals] = useState(false)

  const activeGoals = goals.filter(isGoalActive)
  const pastGoals = goals.filter(g => !isGoalActive(g))

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const weekLabel = (() => {
    const start = format(weekStart, 'd MMM', { locale: nl })
    const end = format(addDays(weekStart, 6), 'd MMM', { locale: nl })
    const year = format(weekStart, 'yyyy')
    return `${start} – ${end} ${year}`
  })()

  const getPlanForDate = useCallback((date: Date) => {
    const key = format(date, 'yyyy-MM-dd')
    if (dailyPlan?.date === key) return dailyPlan
    if (tomorrowPlan?.date === key) return tomorrowPlan
    return planHistory[key] ?? null
  }, [dailyPlan, tomorrowPlan, planHistory])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return

    const assignGoalId = over.data.current?.assignGoalId as string | null | undefined
    if (assignGoalId !== undefined) {
      const projectId = active.data.current?.projectId as string
      assignProjectToGoal(projectId, assignGoalId)
      return
    }

    const toDate = over.data.current?.toDate as string | undefined
    if (!toDate) return

    const projectId = active.data.current?.projectId as string
    const fromDate = active.data.current?.fromDate as string | null

    if (fromDate) {
      const current = weekSlots[fromDate] ?? []
      setWeekSlot(fromDate, current.filter(id => id !== projectId))
    }

    addProjectToSlot(toDate, projectId)
  }

  const activeProjectId = activeId
    ? (activeId.startsWith('sidebar::')
        ? activeId.replace('sidebar::', '')
        : activeId.split('::')[1])
    : null
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null

  function openNewGoal() {
    setEditingGoal(null)
    setGoalFormOpen(true)
  }

  function openEditGoal(goal: Goal) {
    setEditingGoal(goal)
    setGoalFormOpen(true)
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-[20px] font-normal text-charcoal tracking-[-0.01em]">
            Objectives
          </h2>
          <p className="text-[13px] text-stone/60 mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1.5 rounded-[6px] text-stone/50 hover:text-charcoal hover:bg-border-light transition-colors"
            aria-label="Vorige week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1 text-[12px] rounded-[6px] text-stone/60 hover:text-charcoal hover:bg-border-light transition-colors"
          >
            Deze week
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1.5 rounded-[6px] text-stone/50 hover:text-charcoal hover:bg-border-light transition-colors"
            aria-label="Volgende week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Objectives strip */}
      <div className="flex items-stretch gap-2 overflow-x-auto pb-4 mb-2">
        {activeGoals.map(goal => (
          <GoalChip key={goal.id} goal={goal} projects={projects} onClick={() => openEditGoal(goal)} />
        ))}
        <button
          onClick={openNewGoal}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-dashed border-border
            text-[12px] text-stone/50 hover:text-charcoal hover:border-stone/40 transition-colors shrink-0"
        >
          <Plus size={14} />
          Nieuw objective
        </button>
      </div>

      {pastGoals.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowPastGoals(v => !v)}
            className="flex items-center gap-1 text-[11px] text-stone/40 hover:text-stone/60 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showPastGoals ? 'rotate-180' : ''}`} />
            Eerdere objectives ({pastGoals.length})
          </button>
          {showPastGoals && (
            <div className="flex items-stretch gap-2 overflow-x-auto pt-2">
              {pastGoals.map(goal => (
                <GoalChip key={goal.id} goal={goal} projects={projects} onClick={() => openEditGoal(goal)} />
              ))}
            </div>
          )}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4">
          <WeekProjectSidebar projects={projects} goals={activeGoals} onEditGoal={openEditGoal} />
          <div className="flex-1 grid grid-cols-7 gap-3 min-w-0">
            {days.map(date => {
              const key = format(date, 'yyyy-MM-dd')
              const historyPlan = getPlanForDate(date)
              const slotIds = weekSlots[key] ?? []
              return (
                <WeekDayColumn
                  key={key}
                  date={date}
                  projectIds={slotIds}
                  historyPlan={historyPlan}
                  projects={projects}
                  goals={goals}
                  onRemove={projectId => removeProjectFromSlot(key, projectId)}
                />
              )
            })}
          </div>
        </div>

        <DragOverlay>
          {activeProject && (
            <div className="px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px] font-medium text-charcoal shadow-md opacity-90">
              {activeProject.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {goalFormOpen && <GoalForm goal={editingGoal} onClose={() => setGoalFormOpen(false)} />}
    </div>
  )
}
