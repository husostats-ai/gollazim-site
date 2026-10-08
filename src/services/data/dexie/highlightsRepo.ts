import { markPublished } from '../../highlights/highlights'
import type { HighlightsRepo } from '../types'
import { db } from './db'

export const highlightsRepo: HighlightsRepo = {
  listByDate: (date) => db.highlights.where('date').equals(date).toArray(),

  async put(record) {
    await db.highlights.put(record)
  },

  async remove(id) {
    await db.highlights.delete(id)
  },

  async markPublished(ids, publishedAt) {
    await db.transaction('rw', db.highlights, async () => {
      const records = (await db.highlights.bulkGet(ids)).filter((record) => record !== undefined)
      await db.highlights.bulkPut(markPublished(records, ids, publishedAt))
    })
  },
}
