import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { WriteAwayModal } from './WriteAwayModal'

export function WriteAwayButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Schrijf het weg (afleiding / frustratie)"
        className="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full
          bg-charcoal text-canvas shadow-lg hover:bg-charcoal/90
          flex items-center justify-center transition-all
          hover:scale-105 active:scale-95"
      >
        <PenLine size={16} />
      </button>
      {open && <WriteAwayModal onClose={() => setOpen(false)} />}
    </>
  )
}
