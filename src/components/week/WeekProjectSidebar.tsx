import { useDraggable } from '@dnd-kit/core'
import type { Project } from '../../types'

interface Props {
  projects: Project[]
}

function SidebarCard({ project }: { project: Project }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar::${project.id}`,
    data: { projectId: project.id, fromDate: null },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`px-2 py-1.5 rounded-[6px] border border-border bg-canvas text-[12px]
        font-medium text-charcoal cursor-grab active:cursor-grabbing select-none
        transition-opacity ${isDragging ? 'opacity-40' : 'hover:bg-border-light'}`}
    >
      {project.title}
    </div>
  )
}

export function WeekProjectSidebar({ projects }: Props) {
  const active = projects.filter(p => p.status === 'in_progress' || p.status === 'waiting')
  const backlog = projects.filter(p => p.status === 'backlog')

  return (
    <div className="flex flex-col gap-3 w-[160px] shrink-0">
      <div className="text-[11px] uppercase tracking-[0.06em] text-stone/50 font-medium">Projecten</div>
      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5">Actief</div>
          {active.map(p => <SidebarCard key={p.id} project={p} />)}
        </div>
      )}
      {backlog.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-[0.05em] text-stone/40 mb-0.5">Backlog</div>
          {backlog.map(p => <SidebarCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  )
}
