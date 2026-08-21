import { Menu } from '@mantine/core'
import { MoreHorizontal } from 'lucide-react'

interface CardMenuProps {
  id: string
  type: 'project' | 'task'
}

export function CardMenu({ id, type }: CardMenuProps) {
  return (
    <Menu shadow="md" width={200} position="bottom-end">
      <Menu.Target>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-stone transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item disabled>{id} / {type}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
