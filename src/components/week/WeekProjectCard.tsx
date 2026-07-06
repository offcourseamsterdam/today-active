import { useDraggable } from '@dnd-kit/core'
import type { Project } from '../../types'

interface Props {
  project: Project
  dateKey: string
  isReadOnly?: boolean
  onRemove?: () => void
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-amber-100 border-amber-200 text-amber-900',
  waiting: 'bg-blue-50 border-blue-200 text-blue-900',
  backlog: 'bg-stone-100 border-stone-200 text-stone-700',
}

export function WeekProjectCard({ project, dateKey, isReadOnly, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${dateKey}::${project.id}`,
    data: { projectId: project.id, fromDate: dateKey },
    disabled: isReadOnly,
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        flex items-center justify-between gap-1 px-2 py-1.5 rounded-[6px] border text-[12px] font-medium
        select-none cursor-grab active:cursor-grabbing transition-opacity
        ${STATUS_COLORS[project.status] ?? STATUS_COLORS.backlog}
        ${isDragging ? 'opacity-40' : ''}
        ${isReadOnly ? 'cursor-default' : ''}
      `}
    >
      <span className="truncate">{project.title}</span>
      {!isReadOnly && onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="shrink-0 text-current opacity-40 hover:opacity-80 leading-none text-[14px]"
          aria-label="Verwijder"
        >×</button>
      )}
    </div>
  )
}
