import { format, addDays } from 'date-fns'
import { nl } from 'date-fns/locale'
import { X, Moon } from 'lucide-react'
import { useStore } from '../../store'
import { CATEGORY_CONFIG } from '../../types'
import { findTaskById } from '../../lib/taskLookup'

interface TomorrowPeekProps {
  onClose: () => void
}

export function TomorrowPeek({ onClose }: TomorrowPeekProps) {
  const tomorrowPlan = useStore(s => s.tomorrowPlan)
  const projects = useStore(s => s.projects)
  const orphanTasks = useStore(s => s.orphanTasks)
  const recurringTasks = useStore(s => s.recurringTasks)

  const tomorrow = addDays(new Date(), 1)
  const dayName = format(tomorrow, 'EEEE', { locale: nl })
  const dateStr = format(tomorrow, 'd MMMM', { locale: nl })

  const deepBlockProject = tomorrowPlan?.deepBlock.projectId
    ? projects.find(p => p.id === tomorrowPlan!.deepBlock.projectId)
    : null

  const shortTasks = (tomorrowPlan?.shortTasks ?? [])
    .map(id => findTaskById(id, projects, orphanTasks, recurringTasks)?.task)
    .filter(Boolean)

  const hasPlan = deepBlockProject || shortTasks.length > 0 || (tomorrowPlan?.maintenanceTasks.length ?? 0) > 0

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 sm:px-7 pt-7 pb-6 border-b border-border/50">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-stone/35 mb-1">Morgen</div>
          <div className="font-serif text-[20px] text-charcoal capitalize">
            {dayName}, {dateStr}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full text-stone/35 hover:text-charcoal hover:bg-border-light transition-all mt-1"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-7 py-6">
        {!hasPlan ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Moon size={22} className="text-stone/20 mb-4" />
            <div className="text-[14px] text-stone/40 font-serif italic">Nog niets gepland</div>
          </div>
        ) : (
          <div className="space-y-7">

            {/* Deep block */}
            {deepBlockProject && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-stone/35 mb-3">Deep block</div>
                <div className="flex items-center gap-3">
                  <div
                    className="w-[3px] h-10 rounded-full flex-shrink-0"
                    style={{ background: CATEGORY_CONFIG[deepBlockProject.category].color }}
                  />
                  <div>
                    <div className="text-[15px] font-medium text-charcoal leading-snug">
                      {deepBlockProject.title}
                    </div>
                    {tomorrowPlan?.deepBlock.intention && (
                      <div className="text-[12px] text-stone/55 italic mt-0.5">
                        {tomorrowPlan.deepBlock.intention}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Short tasks */}
            {shortTasks.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-stone/35 mb-3">Short tasks</div>
                <div className="space-y-2">
                  {shortTasks.map(task => (
                    <div key={task!.id} className="flex items-start gap-2.5">
                      <div className="w-1 h-1 rounded-full bg-stone/25 flex-shrink-0 mt-[7px]" />
                      <span className="text-[13px] text-charcoal leading-snug">{task!.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Maintenance */}
            {(tomorrowPlan?.maintenanceTasks.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-stone/35 mb-2">Maintenance</div>
                <div className="text-[13px] text-stone">
                  {tomorrowPlan!.maintenanceTasks.length} taken
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
