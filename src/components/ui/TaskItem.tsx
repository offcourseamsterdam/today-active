import { useState, useRef } from 'react'
import { X, FolderOpen } from 'lucide-react'
import { TaskCheckbox } from './TaskCheckbox'
import { useClickOutside } from '../../hooks/useClickOutside'
import type { Project, Task } from '../../types'

export interface TaskItemProps {
  task: Task
  projectTitle?: string
  projects: Project[]
  onToggle: () => void
  onRemove: () => void
  onAssignProject: (projectId: string) => void
  onOpenProject?: (projectId: string) => void
}

export function TaskItem({ task, projectTitle, projects, onToggle, onRemove, onAssignProject, onOpenProject }: TaskItemProps) {
  const isDone = task.status === 'done'
  const isOrphan = !task.projectId
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useClickOutside(pickerRef, () => setShowProjectPicker(false), showProjectPicker)

  return (
    <div className="flex items-center gap-3 py-2 group relative">
      <TaskCheckbox checked={isDone} onChange={onToggle} />
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] ${isDone ? 'text-stone line-through' : 'text-charcoal'}`}>
          {task.title}
        </span>
        {projectTitle && (
          task.projectId && onOpenProject ? (
            <button
              onClick={() => onOpenProject(task.projectId!)}
              className="text-[10px] text-stone/40 ml-2 hover:text-stone transition-colors"
            >
              {projectTitle}
            </button>
          ) : (
            <span className="text-[10px] text-stone/50 ml-2">{projectTitle}</span>
          )
        )}

      </div>

      {/* Assign to project button — only for orphan tasks */}
      {isOrphan && (
        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setShowProjectPicker(v => !v)}
            title="Assign to project"
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all"
          >
            <FolderOpen size={13} />
          </button>

          {showProjectPicker && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border
              rounded-[8px] shadow-lg min-w-[160px] max-w-[220px] py-1 animate-slide-up">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-stone/40 font-medium border-b border-border/50">
                Assign to project
              </div>
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-stone/40 italic">No projects</div>
              ) : (
                <div className="max-h-[180px] overflow-y-auto">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { onAssignProject(p.id); setShowProjectPicker(false) }}
                      className="w-full text-left px-3 py-2 text-[12px] text-charcoal
                        hover:bg-canvas transition-colors truncate"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-stone transition-all"
      >
        <X size={13} />
      </button>
    </div>
  )
}
