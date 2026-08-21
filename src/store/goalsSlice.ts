import { v4 as uuid } from 'uuid'
import type { Goal } from '../types'
import type { StoreSet, StoreGet } from './types'

export function makeGoalActions(set: StoreSet, _get: StoreGet) {
  return {
    addGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString()
      const id = uuid()
      set(state => ({
        goals: [...state.goals, { ...goal, id, createdAt: now, updatedAt: now }],
      }))
      return id
    },

    updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>) => {
      set(state => ({
        goals: state.goals.map(g =>
          g.id === id ? { ...g, ...patch, updatedAt: new Date().toISOString() } : g
        ),
      }))
    },

    deleteGoal: (id: string) => {
      set(state => ({
        goals: state.goals.filter(g => g.id !== id),
        projects: state.projects.map(p =>
          p.goalId === id ? { ...p, goalId: undefined } : p
        ),
      }))
    },

    assignProjectToGoal: (projectId: string, goalId: string | null) => {
      set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? { ...p, goalId: goalId ?? undefined } : p
        ),
      }))
    },
  }
}
