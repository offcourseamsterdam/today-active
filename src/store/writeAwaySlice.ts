import { v4 as uuid } from 'uuid'
import type { WriteAwayEntry } from '../types'
import type { StoreSet, StoreGet } from './types'

export function makeWriteAwayActions(set: StoreSet, _get: StoreGet) {
  return {
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
