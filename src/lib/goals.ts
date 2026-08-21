import type { Goal, Project } from '../types'

export function getGoalProjects(goal: Goal, projects: Project[]): Project[] {
  return projects.filter(p => p.goalId === goal.id)
}

export function getGoalCompletion(goal: Goal, projects: Project[]): { done: number; total: number } {
  const linked = getGoalProjects(goal, projects)
  return { done: linked.filter(p => p.status === 'done').length, total: linked.length }
}

/** Sum of daysWorkedLog entries across linked projects, clamped to the goal's active window. */
export function getGoalDaysWorked(goal: Goal, projects: Project[]): number {
  const linked = getGoalProjects(goal, projects)
  const today = new Date().toISOString().slice(0, 10)
  const end = goal.targetDate < today ? goal.targetDate : today
  let count = 0
  for (const project of linked) {
    for (const date of project.daysWorkedLog ?? []) {
      if (date >= goal.startDate && date <= end) count++
    }
  }
  return count
}

/** A goal is active until its target date has passed. */
export function isGoalActive(goal: Goal): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return goal.targetDate >= today
}
