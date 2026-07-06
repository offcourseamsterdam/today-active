import { useState, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { startOfWeek, addDays, format } from 'date-fns'
import { nl } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../../store'
import { WeekDayColumn } from './WeekDayColumn'
import { WeekProjectSidebar } from './WeekProjectSidebar'

export function WeekPlannerView() {
  const projects = useStore(s => s.projects)
  const weekSlots = useStore(s => s.weekSlots)
  const planHistory = useStore(s => s.planHistory)
  const dailyPlan = useStore(s => s.dailyPlan)
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const addProjectToSlot = useStore(s => s.addProjectToSlot)
  const removeProjectFromSlot = useStore(s => s.removeProjectFromSlot)
  const setWeekSlot = useStore(s => s.setWeekSlot)

  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)

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

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-[20px] font-normal text-charcoal tracking-[-0.01em]">
            Weekplanner
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

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4">
          <WeekProjectSidebar projects={projects} />
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
    </div>
  )
}
