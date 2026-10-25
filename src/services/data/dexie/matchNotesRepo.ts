import type { MatchNotesRepo } from '../types'
import { db } from './db'

export const matchNotesRepo: MatchNotesRepo = {
  async listByMatchIds(matchIds) {
    const rows = await db.matchNotes.bulkGet(matchIds)
    return rows.filter((n) => n !== undefined)
  },

  get: (matchId) => db.matchNotes.get(matchId),

  async put(note) {
    await db.matchNotes.put(note)
  },

  async remove(matchId) {
    await db.matchNotes.delete(matchId)
  },
}
