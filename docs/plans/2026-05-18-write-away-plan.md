# Write Away Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a floating "Write Away" brain-dump button to every screen, a minimal capture modal, and a review tab — urgent work entries auto-create orphan tasks.

**Architecture:** New `writeAwaySlice.ts` Zustand slice; entries stored in `SyncData` (same single-doc Firestore pattern as the rest of the app). `/dump` route is a special URL-match at the top of `App.tsx` (same pattern as `/p/:shareId`). Floating button rendered globally inside the auth shell.

**Tech Stack:** React 19, TypeScript strict, Zustand, Firebase/Firestore, Tailwind v4, lucide-react, uuid

---

### Task 1: Add `WriteAwayEntry` type

**Files:**
- Modify: `src/types/index.ts` (append near `AIFeedbackEntry`)

**Step 1: Add the interface**

```typescript
// Add after AIFeedbackEntry interface:
export interface WriteAwayEntry {
  id: string
  text: string
  tag: 'urgent-work' | 'work' | 'personal'
  createdAt: string   // ISO timestamp
  taskId?: string     // set when urgent-work auto-created an orphan task
}
```

**Step 2: Verify TypeScript**
```bash
cd "/Users/beer/Developer/Vandaag App/.claude/worktrees/elastic-greider-88ba04"
npx tsc --noEmit
```
Expected: no output (clean)

**Step 3: Commit**
```bash
git add src/types/index.ts
git commit -m "feat(write-away): add WriteAwayEntry type"
```

---

### Task 2: Update store types and Firestore sync shape

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/lib/firestore.ts`

**Step 1: Add `writeAway` to `VandaagState` in `src/store/types.ts`**

Add import at top:
```typescript
import type { ..., WriteAwayEntry } from '../types'
// (add WriteAwayEntry to the existing import from '../types')
```

Add to `VandaagState` interface (near `personalRules`):
```typescript
writeAwayEntries: WriteAwayEntry[]
```

Add `'write-away'` to the `ActiveView` union (line ~25):
```typescript
export type ActiveView = 'vandaag' | 'kanban' | 'planning' | 'philosophy' | 'meetings' | 'review' | 'write-away'
```

**Step 2: Add `writeAway` to `SyncData` in `src/lib/firestore.ts`**

Add import:
```typescript
import type { Project, Task, Meeting, Settings, DailyPlan, WriteAwayEntry } from '../types'
```

Add to `SyncData` interface (after `personalRules`):
```typescript
writeAway: WriteAwayEntry[]
```

**Step 3: Verify**
```bash
npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/store/types.ts src/lib/firestore.ts
git commit -m "feat(write-away): add writeAway to store types and SyncData"
```

---

### Task 3: Create `writeAwaySlice.ts`

**Files:**
- Create: `src/store/writeAwaySlice.ts`

**Step 1: Write the slice**

```typescript
import { v4 as uuid } from 'uuid'
import type { WriteAwayEntry } from '../types'
import type { StoreSet, StoreGet } from './types'

export function makeWriteAwayActions(set: StoreSet, _get: StoreGet) {
  return {
    writeAwayEntries: [] as WriteAwayEntry[],

    addWriteAwayEntry: (entry: Omit<WriteAwayEntry, 'id' | 'createdAt'>): string => {
      const id = uuid()
      const full: WriteAwayEntry = {
        ...entry,
        id,
        createdAt: new Date().toISOString(),
      }
      set(state => ({ writeAwayEntries: [full, ...state.writeAwayEntries] }))
      return id
    },

    updateWriteAwayEntry: (id: string, updates: Partial<WriteAwayEntry>) => {
      set(state => ({
        writeAwayEntries: state.writeAwayEntries.map(e =>
          e.id === id ? { ...e, ...updates } : e
        ),
      }))
    },

    deleteWriteAwayEntry: (id: string) => {
      set(state => ({
        writeAwayEntries: state.writeAwayEntries.filter(e => e.id !== id),
      }))
    },

    setWriteAwayEntries: (entries: WriteAwayEntry[]) => {
      set({ writeAwayEntries: entries })
    },
  }
}
```

**Step 2: Verify**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/store/writeAwaySlice.ts
git commit -m "feat(write-away): add writeAwaySlice"
```

---

### Task 4: Wire slice into the main store

**Files:**
- Modify: `src/store/index.ts`

**Step 1: Import the slice factory**

Add near the other slice imports:
```typescript
import { makeWriteAwayActions } from './writeAwaySlice'
```

**Step 2: Add initial state**

In the `create()` call, add alongside `personalRules: []`:
```typescript
writeAwayEntries: [],
```

**Step 3: Spread actions**

In the `create()` call where the other slices are spread, add:
```typescript
...makeWriteAwayActions(set, get),
```

**Step 4: Verify**
```bash
npx tsc --noEmit
```

**Step 5: Commit**
```bash
git add src/store/index.ts
git commit -m "feat(write-away): wire writeAwaySlice into store"
```

---

### Task 5: Wire into Firestore sync

**Files:**
- Modify: `src/hooks/useFirestoreSync.ts`

**Step 1: Add `writeAway` to the `extractSyncData` selector**

Find where `personalRules: s.personalRules` is read (around line 21) and add:
```typescript
writeAway: s.writeAwayEntries,
```

**Step 2: Add `writeAway` to the remote load block**

Find where `personalRules: remote.personalRules ?? []` is set (around line 78) and add:
```typescript
writeAwayEntries: remote.writeAway ?? [],
```

**Step 3: Verify**
```bash
npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/hooks/useFirestoreSync.ts
git commit -m "feat(write-away): sync writeAway entries with Firestore"
```

---

### Task 6: Create `WriteAwayModal`

**Files:**
- Create: `src/components/writeaway/WriteAwayModal.tsx`

**Step 1: Write the component**

```typescript
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Zap } from 'lucide-react'
import { useStore } from '../../store'

type Tag = 'urgent-work' | 'work' | 'personal'

interface WriteAwayModalProps {
  onClose: () => void
  /** When true, shows a post-submit confirmation instead of just closing */
  standalone?: boolean
}

const TAG_OPTIONS: { value: Tag; label: string; color: string }[] = [
  { value: 'urgent-work', label: 'Urgent werk', color: 'text-red-600' },
  { value: 'work',        label: 'Werk',        color: 'text-stone' },
  { value: 'personal',    label: 'Persoonlijk',  color: 'text-stone' },
]

export function WriteAwayModal({ onClose, standalone }: WriteAwayModalProps) {
  const addWriteAwayEntry = useStore(s => s.addWriteAwayEntry)
  const updateWriteAwayEntry = useStore(s => s.updateWriteAwayEntry)
  const addTask = useStore(s => s.addTask)

  const [text, setText] = useState('')
  const [tag, setTag] = useState<Tag>('work')
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [text, tag]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed) return

    const entryId = addWriteAwayEntry({ text: trimmed, tag })

    if (tag === 'urgent-work') {
      const taskId = addTask(trimmed, undefined)
      updateWriteAwayEntry(entryId, { taskId })
    }

    if (standalone) {
      setSubmitted(true)
    } else {
      onClose()
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-card rounded-[16px] shadow-2xl border border-border
        w-[520px] max-w-[94vw] p-6 animate-scale-in">

        {submitted ? (
          /* Post-submit confirmation (standalone /dump only) */
          <div className="py-8 text-center space-y-3">
            <div className="text-[32px]">✓</div>
            <div className="text-[15px] font-medium text-charcoal">Weggeschreven.</div>
            <p className="text-[13px] text-stone/60">Je kunt dit tabblad sluiten.</p>
          </div>
        ) : (
          <>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-stone/40 hover:text-stone transition-colors"
            >
              <X size={16} />
            </button>

            <h2 className="text-[13px] uppercase tracking-[0.08em] text-stone font-medium mb-4">
              Schrijf het weg
            </h2>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Afleiding of frustratie... schrijf het gewoon op."
              rows={4}
              className="w-full px-3 py-2.5 text-[14px] text-charcoal placeholder:text-stone/30
                border border-border rounded-[8px] bg-canvas outline-none
                focus:border-stone/40 resize-none leading-relaxed"
            />

            {/* Tag selection */}
            <div className="flex items-center gap-3 mt-3">
              {TAG_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="tag"
                    value={opt.value}
                    checked={tag === opt.value}
                    onChange={() => setTag(opt.value)}
                    className="accent-charcoal"
                  />
                  <span className={`text-[12px] font-medium ${tag === opt.value ? opt.color : 'text-stone/50'}`}>
                    {opt.label}
                    {opt.value === 'urgent-work' && tag === 'urgent-work' && (
                      <Zap size={10} className="inline ml-1 text-red-500" />
                    )}
                  </span>
                </label>
              ))}
            </div>

            {tag === 'urgent-work' && (
              <p className="mt-2 text-[11px] text-red-500/70">
                Maakt een losse taak aan in je inbox.
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="mt-4 w-full py-2.5 rounded-[8px] bg-charcoal text-canvas text-[13px]
                font-medium hover:bg-charcoal/90 transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Dump & Klaar  <span className="text-canvas/40 text-[11px] ml-1">⌘↵</span>
            </button>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
```

**Step 2: Verify**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/components/writeaway/WriteAwayModal.tsx
git commit -m "feat(write-away): add WriteAwayModal component"
```

---

### Task 7: Create `WriteAwayButton`

**Files:**
- Create: `src/components/writeaway/WriteAwayButton.tsx`

**Step 1: Write the component**

```typescript
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
```

**Step 2: Verify**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/components/writeaway/WriteAwayButton.tsx
git commit -m "feat(write-away): add floating WriteAwayButton"
```

---

### Task 8: Create `WriteAwayPage`

**Files:**
- Create: `src/components/writeaway/WriteAwayPage.tsx`

**Step 1: Write the component**

```typescript
import { useStore } from '../../store'
import { Trash2, Zap } from 'lucide-react'
import { format } from 'date-fns'
import { nl } from 'date-fns/locale'

const TAG_LABELS: Record<string, { label: string; className: string }> = {
  'urgent-work': { label: 'Urgent werk', className: 'bg-red-50 text-red-600 border-red-100' },
  'work':        { label: 'Werk',        className: 'bg-stone/8 text-stone border-stone/20' },
  'personal':    { label: 'Persoonlijk', className: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
}

export function WriteAwayPage() {
  const entries = useStore(s => s.writeAwayEntries)
  const deleteWriteAwayEntry = useStore(s => s.deleteWriteAwayEntry)

  return (
    <div className="max-w-[640px] mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[11px] uppercase tracking-[0.08em] text-stone font-medium mb-6">
        Write Away — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </h1>

      {entries.length === 0 ? (
        <p className="text-[13px] text-stone/40 py-12 text-center">
          Nog niets weggeschreven.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map(entry => {
            const tag = TAG_LABELS[entry.tag]
            return (
              <li
                key={entry.id}
                className="rounded-[10px] border border-border bg-card p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] text-charcoal leading-relaxed flex-1">
                    {entry.text}
                  </p>
                  <button
                    onClick={() => deleteWriteAwayEntry(entry.id)}
                    className="opacity-0 group-hover:opacity-40 hover:!opacity-100
                      text-stone hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${tag.className}`}>
                    {tag.label}
                  </span>
                  {entry.taskId && (
                    <span className="text-[10px] text-stone/50 flex items-center gap-1">
                      <Zap size={9} /> taak aangemaakt
                    </span>
                  )}
                  <span className="text-[10px] text-stone/30 ml-auto">
                    {format(new Date(entry.createdAt), 'd MMM, HH:mm', { locale: nl })}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

**Step 2: Verify**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/components/writeaway/WriteAwayPage.tsx
git commit -m "feat(write-away): add WriteAwayPage review tab"
```

---

### Task 9: Wire everything into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add `/dump` route at the top of `App()` (right after the `shareMatch` block)**

```typescript
// Write Away standalone dump page — no auth, no store needed for the modal itself
const dumpMatch = useMemo(() => window.location.pathname === '/dump', [])
if (dumpMatch) {
  return (
    <Suspense fallback={null}>
      <WriteAwayModal onClose={() => {}} standalone />
    </Suspense>
  )
}
```

Note: for `/dump` the store IS needed (to save entries), so we need the app context. Change the pattern to render inside the auth shell — see Step 4.

**Step 1 (revised): Add `/dump` route detection as state, not early return**

At the top of `App()`, before any hooks:
```typescript
const isDumpRoute = useMemo(() => window.location.pathname === '/dump', [])
```

**Step 2: Import new components**

Add to imports:
```typescript
import { WriteAwayButton } from './components/writeaway/WriteAwayButton'
import { WriteAwayPage } from './components/writeaway/WriteAwayPage'
import { WriteAwayModal } from './components/writeaway/WriteAwayModal'
```

**Step 3: Add Write Away tab to the nav (after Review tab)**

In the `<nav>` section, add after the Review button:
```tsx
<button
  onClick={() => setActiveView('write-away')}
  className={`px-3 py-1.5 rounded-[6px] text-[13px] font-medium transition-colors
    ${activeView === 'write-away'
      ? 'bg-charcoal/8 text-charcoal'
      : 'text-stone/60 hover:text-charcoal hover:bg-charcoal/5'}`}
>
  Write Away
</button>
```

**Step 4: Add view rendering**

In the main view switch (after `activeView === 'review'`), add:
```tsx
) : activeView === 'write-away' ? (
  <WriteAwayPage />
```

**Step 5: Add floating button globally**

Just before the closing tag of the auth shell (before the final `</div>` that wraps everything), add:
```tsx
{/* Floating Write Away button — visible on all screens */}
{!isDumpRoute && <WriteAwayButton />}
```

**Step 6: Handle `/dump` route — render just the modal fullscreen**

At the start of the rendered output (after auth checks pass), before the nav, check:
```tsx
{isDumpRoute ? (
  <WriteAwayModal onClose={() => {}} standalone />
) : (
  /* ... existing full app render ... */
)}
```

**Step 7: Verify build**
```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```
Expected: `✓ built in Xs`

**Step 8: Commit**
```bash
git add src/App.tsx
git commit -m "feat(write-away): wire button, tab, /dump route into App"
```

---

### Task 10: Final push and smoke test

**Step 1: Push to main**
```bash
cd "/Users/beer/Developer/Vandaag App"
git push origin claude/elastic-greider-88ba04:main
```

**Step 2: Manual smoke test checklist**
- [ ] Floating ✏️ button visible on Vandaag, Kanban, Meetings, Review screens
- [ ] Click button → modal opens with textarea focused
- [ ] Type text, select "Urgent werk", click Dump — entry appears in Write Away tab AND a new orphan task exists
- [ ] Type text, select "Werk", click Dump — entry appears in Write Away tab, no task created
- [ ] Cmd+Enter submits
- [ ] Escape closes without saving
- [ ] Navigate to `https://vandaag-app-three.vercel.app/dump` → just the modal, no nav
- [ ] Submit on `/dump` → shows "Weggeschreven ✓" confirmation
- [ ] Write Away tab shows all entries with correct tag chips and timestamps
- [ ] Delete button on an entry removes it
