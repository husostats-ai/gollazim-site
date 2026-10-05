import type { UploadsRepo } from '../types'
import { db } from './db'

export const uploadsRepo: UploadsRepo = {
  list: () => db.uploads.orderBy('uploadedAt').reverse().toArray(),

  async add(upload) {
    await db.uploads.put(upload)
  },

  async remove(id) {
    const tables = [db.uploads, db.matches, db.results, db.picks, db.aiVerdicts, db.aiPrompts]
    await db.transaction('rw', tables, async () => {
      const removed = await db.matches.where('uploadId').equals(id).toArray()
      const matchIds = removed.map((m) => m.id)
      await db.picks.where('matchId').anyOf(matchIds).delete()
      await db.aiVerdicts.where('matchId').anyOf(matchIds).delete()
      await db.results.bulkDelete(matchIds)
      await db.matches.bulkDelete(matchIds)
      await db.uploads.delete(id)
      // Maçı kalmayan günlerin prompt numaralandırması da silinir.
      for (const date of new Set(removed.map((m) => m.date))) {
        if ((await db.matches.where('date').equals(date).count()) === 0) await db.aiPrompts.where('date').equals(date).delete()
      }
    })
  },
}
