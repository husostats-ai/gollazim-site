import type { AiRepo } from '../types'
import { db } from './db'

export const aiRepo: AiRepo = {
  listVerdicts: () => db.aiVerdicts.toArray(),

  listVerdictsByDate: (date) => db.aiVerdicts.where('date').equals(date).toArray(),

  async saveVerdicts(verdicts) {
    await db.aiVerdicts.bulkPut(verdicts)
  },

  async removeVerdict(id) {
    await db.aiVerdicts.delete(id)
  },

  getPromptBatch: (date, provider) => db.aiPrompts.get(`${date}|${provider}`),

  async savePromptBatch(batch) {
    await db.aiPrompts.put(batch)
  },
}
