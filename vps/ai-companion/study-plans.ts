import type { CareHubState, StudyGoal } from './care-hub.ts'

function completedOn(goal: StudyGoal, date: string): boolean {
  if (goal.schedule === 'daily' || goal.schedule === 'dates') return !!goal.completedDates?.includes(date)
  return !!goal.done
}

export function studyPlanDetails(state: CareHubState, date: string, includeCompleted = false) {
  const source = includeCompleted
    ? state.study.goals
    : state.study.goals.filter((goal) => goal.schedule !== 'once' || !goal.done)
  const plans = source.slice(0, 100).map((goal) => {
    const schedule = goal.schedule || 'once'
    const appliesToday = schedule === 'daily'
      || (schedule === 'dates' && !!goal.dates?.includes(date))
      || (schedule === 'once' && (!goal.targetDate || goal.targetDate === date))
    return {
      id: goal.id,
      title: goal.title,
      schedule,
      ...(goal.targetDate ? { targetDate: goal.targetDate } : {}),
      ...(schedule === 'dates' ? { dates: goal.dates ?? [] } : {}),
      appliesToday,
      completedToday: completedOn(goal, date),
      done: goal.done,
      overdue: schedule === 'once' && !goal.done && !!goal.targetDate && goal.targetDate < date,
    }
  })
  return { plans, truncated: source.length > plans.length }
}
