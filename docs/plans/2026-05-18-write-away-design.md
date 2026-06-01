# Write Away — Design Doc
_2026-05-18_

## Goal
Low-friction brain dump for distractions and frustrations. Capture it, tag it, dismiss it. Urgent work items auto-become orphan tasks. Everything else just sits in a log to review later.

## Scope (what's in)
- Floating trigger button on every in-app screen
- `/dump` standalone route — same modal, no nav, for use outside the app tab
- Write Away modal: textarea + 3 tags + Dump & Dismiss
- Urgent work → creates standalone orphan task automatically
- Write Away tab in nav for reviewing entries
- Firestore persistence

## Scope (what's out)
- Breathing timer / calming microflow
- AI reflection prompts
- Auto-archiving / export
- Notification suppression settings
- Dark mode toggle (separate concern)

---

## Data Model

Firestore collection: `users/{uid}/writeAway/{entryId}`

```typescript
interface WriteAwayEntry {
  id: string
  text: string
  tag: 'urgent-work' | 'work' | 'personal'
  createdAt: string   // ISO timestamp
  taskId?: string     // set when urgent-work auto-created an orphan task
}
```

Zustand slice: `writeAwaySlice.ts`
- State: `entries: WriteAwayEntry[]`
- Actions: `addWriteAwayEntry`, `deleteWriteAwayEntry`, `setWriteAwayEntries`

Firestore sync: same pattern as other collections — load on auth, write on change.

---

## Components

### `WriteAwayButton`
- Fixed position, bottom-right corner (`fixed bottom-6 right-6 z-50`)
- Small circular button, pencil or lightning icon
- Clicking sets `writeAwayOpen = true` in local/global state
- Rendered globally in `App.tsx` inside the auth shell

### `WriteAwayModal`
- Full-screen portal overlay (same pattern as `MakeActionablePanel`)
- Auto-focuses textarea on open
- Textarea: placeholder "Write it away..."
- 3 radio options: **Urgent work** / **Work** / **Personal** (default: Work)
- **Dump & Dismiss** button
  - Saves entry to Firestore
  - If tag is `urgent-work`: calls `addTask(text, undefined)` → orphan task, stores taskId on entry
  - Closes modal, resets form
- Cmd+Enter / Ctrl+Enter submits
- Escape closes without saving

### `WriteAwayPage`
- New top-level route/tab: "Write Away" in nav
- Lists entries newest-first
- Each entry: text, tag chip (color-coded), timestamp, delete button
- If `taskId` is set: small "→ Task created" badge
- Empty state: "Nothing written away yet."

### `/dump` route
- Renders just `WriteAwayModal` fullscreen — no nav, no app shell
- On successful submit: shows brief "Dumped ✓" confirmation, then closes tab (`window.close()`) or redirects to home if can't close
- On Escape: closes tab / redirects

---

## Wiring

| Touch point | Change |
|---|---|
| `src/store/index.ts` | Add `writeAwaySlice` |
| `src/store/writeAwaySlice.ts` | New slice |
| `src/lib/firestore.ts` | Add `writeAway` collection sync |
| `src/types/index.ts` | Add `WriteAwayEntry` interface |
| `src/App.tsx` | Render `WriteAwayButton` globally; add `/dump` route; add Write Away tab to nav |
| `src/components/writeaway/WriteAwayButton.tsx` | New |
| `src/components/writeaway/WriteAwayModal.tsx` | New |
| `src/components/writeaway/WriteAwayPage.tsx` | New |

---

## Keyboard shortcut setup (Chrome)
1. Visit `/dump`, star it → Bookmarks Bar, make it item #1 → **Cmd+1** opens it
2. With Raycast/Alfred: add Web Bookmark → assign global hotkey (e.g. `⌥Space D`)
