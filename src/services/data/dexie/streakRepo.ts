import { markStreakPublished, syncStepSchedule } from '../../streak/streak'
import type { StreakRepo } from '../types'
import { db } from './db'

export const streakRepo: StreakRepo = {
  listAll: () => db.streakSteps.orderBy('seq').toArray(),

  async putMany(records) {
    await db.streakSteps.bulkPut(records)
  },

  async remove(id) {
    await db.streakSteps.delete(id)
  },

  async markPublished(ids, publishedAt) {
    await db.transaction('rw', db.streakSteps, async () => {
      const records = (await db.streakSteps.bulkGet(ids)).filter((record) => record !== undefined)
      await db.streakSteps.bulkPut(markStreakPublished(records, ids, publishedAt))
    })
  },

  async syncSchedule(matchId, schedule) {
    await db.transaction('rw', db.streakSteps, async () => {
      await db.streakSteps.bulkPut(syncStepSchedule(await db.streakSteps.toArray(), matchId, schedule))
    })
  },
}
