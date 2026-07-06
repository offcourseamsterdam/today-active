# Daglog + Weekplanner — Design

**Datum:** 2026-07-06  
**Status:** Approved

## Doel

Twee samenhangende features:

1. **Daglog** — elke dag wordt volledig opgeslagen in een historisch archief. Onafgemaakte taken rollen automatisch door naar de volgende dag.
2. **Weekplanner** — een Kanban-bord (ma–zo) waarop de gebruiker projecten per dag kan inplannen, met navigatie door weken. Verleden weken zijn leesbaar via de daglog.

---

## Data-architectuur

### Nieuw: `planHistory`

```typescript
planHistory: Record<string, DailyPlan>
// key = YYYY-MM-DD
```

Bevat de complete `DailyPlan` per dag. Wordt toegevoegd aan:
- Zustand store (gepersisteerd via `persist`)
- `SyncData` in `firestore.ts` (opgeslagen in `users/{uid}`)

### Nieuw: `weekSlots`

```typescript
weekSlots: Record<string, string[]>
// key = YYYY-MM-DD, value = projectIds
```

Lichtgewicht: alleen welke projecten op een toekomstige dag staan. Geen volledige `DailyPlan`-structuur nodig voor toekomstige dagen.

### Bestaande structuur blijft intact

`dailyPlan` en `tomorrowPlan` blijven bestaan als convenience-velden voor vandaag en morgen.

---

## Rollover-logica

Trigger: `refreshDailyPlan()` detecteert een verouderd `dailyPlan` (date < today).

Stappen:
1. Sla het verouderde plan op in `planHistory[plan.date]`
2. Verzamel onafgemaakte items:
   - `shortTasks` waarvan `task.status !== 'done'` en niet in `completedItemIds`
   - `maintenanceTasks` waarvan `task.status !== 'done'` en niet in `completedItemIds`
   - Projecten in `shortProjects` / `maintenanceProjects` (altijd meenemen, gebruiker besluit)
3. Pre-populate vandaag's plan met die items (deep block niet meenemen)
4. Vandaag's plan begint met `isComplete: false`

---

## Weekplanner-view

### Locatie

Nieuw tabblad in de planning-sectie, naast de bestaande "Vandaag"-view. Werktitel: **"Week"**.

### Layout

Kanban-bord met zeven kolommen: ma t/m zo van de geselecteerde week.

Per kolom:
- Datum + dagnaam als header (bv. "Ma 7 jul")
- "Vandaag"-indicator op de huidige dag
- Projectkaartjes: naam + projectkleur, geen taakdetails
- Drop-zone voor drag-and-drop

### Data per kolom

| Dag | Databron |
|-----|----------|
| Verleden | `planHistory[date].deepBlock` + `shortProjects` + `maintenanceProjects` (read-only) |
| Vandaag | `dailyPlan` (read-only in week-view, link naar dagview) |
| Morgen | `tomorrowPlan.shortProjects` etc. (bewerkbaar) |
| Toekomst | `weekSlots[date]` (bewerkbaar via DnD) |

### Navigatie

← Vorige week / Volgende week → (geen limiet op verleden of toekomst).

### Interactie

- **Toekomstige dagen**: sleep projecten vanuit een zijbalk (alle actieve projecten) naar een dag
- **Verleden/vandaag**: read-only, toont wat er gepland/gedaan was
- **Klik op vandaag**: navigeert naar de dagview

---

## Nieuwe store-acties

```typescript
// planHistory
archiveDailyPlan(date: string, plan: DailyPlan): void
getPlanForDate(date: string): DailyPlan | null

// weekSlots
setWeekSlot(date: string, projectIds: string[]): void
addProjectToSlot(date: string, projectId: string): void
removeProjectFromSlot(date: string, projectId: string): void
getWeekSlots(weekStart: string): Record<string, string[]>
```

---

## Componenten

| Component | Beschrijving |
|-----------|-------------|
| `WeekPlannerView` | Hoofd-container, weeknavigatie, bouwt de 7 kolommen |
| `WeekDayColumn` | Één dag: header + projectkaartjes + drop-zone |
| `WeekProjectCard` | Projectkaartje (naam + kleur, draggable) |
| `WeekProjectSidebar` | Lijst van alle actieve projecten als drag-source |

DnD via bestaande `@dnd-kit` (al aanwezig in het project).

---

## Niet in scope

- Taken op de weekplanner (alleen projecten)
- Tijdsblokken of agenda-integratie
- Teamweergave / meerdere gebruikers
