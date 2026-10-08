import type { AiSharesRepo } from '../types'
import { db } from './db'

export const aiSharesRepo: AiSharesRepo = {
  listAll: () => db.aiShares.toArray(),
  listByDate: (date) => db.aiShares.where('date').equals(date).toArray(),
  getMany: async (ids) => (await db.aiShares.bulkGet(ids)).filter((record) => record !== undefined),

  async putMany(records) {
    await db.aiShares.bulkPut(records)
  },
}
