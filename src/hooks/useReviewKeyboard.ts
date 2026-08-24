import { useEffect } from 'react'
import type { InboxActions } from '../components/review/InboxSection'

type SectionId = 'inbox' | 'projects' | 'recurring' | 'summary'

interface UseReviewKeyboardConfig {
  activeSection: SectionId
  setActiveSection: (id: SectionId) => void
  sectionRefs: Record<SectionId, HTMLDivElement | null>
  inboxActionsRef: React.RefObject<InboxActions | null>
  focusedProjectIndex: number
  setFocusedProjectIndex: (i: number | ((prev: number) => number)) => void
  projectCount: number
  toggleProjectExpanded: (index: number) => void
}

const SECTION_IDS: SectionId[] = ['inbox', 'projects', 'recurring', 'summary']

export function useReviewKeyboard(config: UseReviewKeyboardConfig) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Global: 1-4 jump sections
      const num = parseInt(e.key)
      if (num >= 1 && num <= 4) {
        e.preventDefault()
        const sectionId = SECTION_IDS[num - 1]
        config.setActiveSection(sectionId)
        setTimeout(() => {
          config.sectionRefs[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
        return
      }

      // Inbox shortcuts
      if (config.activeSection === 'inbox' && config.inboxActionsRef.current) {
        const actions = config.inboxActionsRef.current
        switch (e.key.toLowerCase()) {
          case 'p': e.preventDefault(); actions.toggleProjectPicker(); return
          case 'h': e.preventDefault(); actions.keep(); return
          case 'f': e.preventDefault(); actions.done(); return
          case 'd': e.preventDefault(); actions.delete(); return
          case 's': e.preventDefault(); actions.skip(); return
          case 'z':
            if (e.metaKey || e.ctrlKey || !e.shiftKey) {
              e.preventDefault(); actions.undo(); return
            }
            break
        }
      }

      // Projects shortcuts — 'j'/'k' only (not ArrowDown/ArrowUp, which must stay
      // free for native page scrolling; focusedProjectIndex has no visible
      // indicator, so hijacking arrow keys made scrolling feel silently stuck).
      if (config.activeSection === 'projects' && config.projectCount > 0) {
        switch (e.key) {
          case 'j':
            e.preventDefault()
            config.setFocusedProjectIndex(i => Math.min(i + 1, config.projectCount - 1))
            return
          case 'k':
            e.preventDefault()
            config.setFocusedProjectIndex(i => Math.max(i - 1, 0))
            return
          case 'Enter':
            e.preventDefault()
            config.toggleProjectExpanded(config.focusedProjectIndex)
            return
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [config])
}
