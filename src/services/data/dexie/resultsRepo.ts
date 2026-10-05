import type { MatchResult } from '../../../types'
import type { ResultsRepo } from '../types'
import { db } from './db'

export const resultsRepo: ResultsRepo = {
  get: (matchId) => db.results.get(matchId),

  async listByMatchIds(matchIds) {
    const rows = await db.results.bulkGet(matchIds)
    return rows.filter((r): r is MatchResult => r !== undefined)
  },

  async save(result) {
    await db.results.put(result)
  },

  async remove(matchId) {
    await db.results.delete(matchId)
  },
}
