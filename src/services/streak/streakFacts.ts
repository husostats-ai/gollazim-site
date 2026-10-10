import type { Match, MatchResult, Pick, StreakStep } from '../../types'
import { streakStepId, type StepFacts } from './streak'

/** Adımların sonuçlarının okunduğu kayıtlar */
export interface StreakData {
  matches: readonly Pick_<Match, 'id'>[]
  results: readonly MatchResult[]
  picks: readonly Pick[]
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

/** Kayıtlardan, adımın sonucunun okunduğu görünüm */
export function factsFrom(data: StreakData): (record: StreakStep) => StepFacts {
  const matchIds = new Set(data.matches.map((m) => m.id))
  const resultById = new Map(data.results.map((r) => [r.matchId, r]))
  const pickById = new Map(data.picks.map((p) => [streakStepId(p.matchId, p.categoryId), p]))
  return (record) => {
    const pick = pickById.get(record.id)
    const result = resultById.get(record.matchId)
    return { matchExists: matchIds.has(record.matchId), ...(pick && { pick }), ...(result && { result }) }
  }
}
