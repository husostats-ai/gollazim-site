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
}
