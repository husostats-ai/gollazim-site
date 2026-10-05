import type { PicksRepo } from '../types'
import { db } from './db'

export const picksRepo: PicksRepo = {
  listAll: () => db.picks.toArray(),

  listByDate: (date) => db.picks.where('date').equals(date).toArray(),

  listByMatch: (matchId) => db.picks.where('matchId').equals(matchId).toArray(),

  async replaceForMatch(matchId, picks) {
    await db.transaction('rw', db.picks, async () => {
      await db.picks.where('matchId').equals(matchId).delete()
      await db.picks.bulkPut(picks)
    })
  },
}
