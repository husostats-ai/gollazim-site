import type { SharedRepo } from '../types'
import { db } from './db'

export const sharedRepo: SharedRepo = {
  listAll: () => db.sharedPicks.toArray(),

  listByDate: (date) => db.sharedPicks.where('date').equals(date).toArray(),

  async addMany(records) {
    await db.sharedPicks.bulkPut(records)
  },

  async markRemoved(id, removedAt) {
    await db.sharedPicks.update(id, { removedAt })
  },
}
