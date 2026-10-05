import type { UploadsRepo } from '../types'
import { db } from './db'

export const uploadsRepo: UploadsRepo = {
  list: () => db.uploads.orderBy('uploadedAt').reverse().toArray(),

  async add(upload) {
    await db.uploads.put(upload)
  },

  async remove(id) {
    await db.transaction('rw', db.uploads, db.matches, db.results, db.picks, async () => {
      const matchIds = await db.matches.where('uploadId').equals(id).primaryKeys()
      await db.picks.where('matchId').anyOf(matchIds).delete()
      await db.results.bulkDelete(matchIds)
      await db.matches.bulkDelete(matchIds)
      await db.uploads.delete(id)
    })
  },
}
