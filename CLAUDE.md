# Vandaag — daily planning app

Personal productivity / "today" planner in Dutch. Vite + React 19 + TS, Mantine UI + Tailwind v4, Zustand store, Firebase (auth + Firestore), OpenAI-backed Vercel serverless functions.

## Commands

```bash
npm run dev      # Vite dev server (with custom /api proxy — no `vercel dev` needed)
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm run preview  # serve the dist/ build locally
```

`npm run dev` proxies `/api/*` to the real `api/*.ts` Vercel handlers via `devApiPlugin` in `vite.config.ts`. The plugin loads **all** env vars from `.env` (not just `VITE_*`) so handlers can read `OPENAI_API_KEY`.

## Architecture

- `src/App.tsx` — top-level shell; handles `/p/:shareId` standalone route, otherwise renders the main app.
- `src/components/vandaag/` — the daily "today" view (the headline feature).
- `src/components/kanban/`, `review/`, `planning/`, `meetings/`, `philosophy/`, `shared/`, `editor/`, `ui/` — feature areas.
- `src/store/` — Zustand store, one slice per feature (`tasksSlice.ts`, `projectsSlice.ts`, `meetingsSlice.ts`, …). Aggregated in `store/index.ts`.
- `src/lib/` — pure utilities (`firebase.ts`, `firestore.ts`, audio, calendar, recurrence, share, etc.).
- `src/hooks/` — `useAuth`, `useFirestoreSync`, etc.
- `api/` — Vercel serverless functions: `transcribe.ts`, `meeting-notes.ts`, `done-reflection.ts`, `project-decisions.ts`, `recent-meeting-summary.ts`, `health.ts`.

## Deploy / hosting

- **Vercel project:** `vandaag-app` on team **`halveybeers-projects`** (NOT `offcourseamsterdam` — that's the GitHub org name, which is a separate system).
- **Production URL:** `https://vandaag-app-three.vercel.app`.
- **GitHub repo:** `offcourseamsterdam/today-active` → `main` is the production branch.
- Run `vercel` CLI commands from the **main project directory** (`/Users/beer/Developer/Vandaag App`), not from a `.claude/worktrees/*` — worktrees don't carry the `.vercel/` link.
- Per-route function limits (memory / maxDuration) live in `vercel.json`.

## Environment variables

Local `.env` must include: `VITE_FIREBASE_*` (six keys) and `OPENAI_API_KEY`.

On Vercel (Production env): same set required. The `VITE_FIREBASE_*` keys are set; `OPENAI_API_KEY` is currently **missing in production** (verifiable via `https://vandaag-app-three.vercel.app/api/health`). All `/api/*` AI features fail in prod until that's added.

## Routing

SPA routing: `vercel.json` rewrites `/p/:path*` → `/index.html` for shared-project pages, handled in `App.tsx` by the `^/p/([a-zA-Z0-9]+)` match.

## Conventions

- TypeScript strict; ESLint with `typescript-eslint`, `react-hooks`, `react-refresh`.
- React 19 + functional components.
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`; config in CSS).
- Zustand slice pattern — when adding state, create or extend a slice in `store/`.
- Heavy components are `lazy()`-imported in `App.tsx`.
- Manual rollup chunks for vendor splitting (`vendor-firebase`, `vendor-dnd`, `vendor-editor`, `vendor-dates`).

## Gotchas

- **Vercel team name ≠ GitHub org name** (see Deploy section). Don't suggest `--scope offcourseamsterdam`.
- **GitHub repo is `today-active`** — was renamed from `today`. Local git remote should point to `today-active.git`.
- **Dev API plugin loads all env vars, not just `VITE_*`** — don't add fallback logic in `api/*.ts` for "missing in dev".
- **No `vercel dev` needed** locally — the custom Vite plugin handles it.
- **Worktree limitation** — `vercel` CLI in `.claude/worktrees/*` won't find `.vercel/project.json`. Switch to the main project dir.
