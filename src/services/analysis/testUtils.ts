import type { Match, StatValue } from '../../types'

let counter = 0

export const makeMatch = (stats: Record<string, StatValue>, overrides: Partial<Match> = {}): Match => {
  counter++
  return {
    id: `m${counter}`,
    uploadId: 'u1',
    date: '2026-10-05',
    time: '20:00',
    home: `Ev ${counter}`,
    away: `Dep ${counter}`,
    stats,
    ...overrides,
  }
}
