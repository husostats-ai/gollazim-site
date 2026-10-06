import type { Match } from '../../../types'
import type { MatchesRepo } from '../types'
import { db } from './db'

export const matchesRepo: MatchesRepo = {
  async listDates() {
    const dates = await db.matches.orderBy('date').uniqueKeys()
    return (dates as string[]).reverse()
  },

  listByDate: (date) => db.matches.where('date').equals(date).toArray(),

  get: (id) => db.matches.get(id),

  async getMany(ids) {
    const rows = await db.matches.bulkGet(ids)
    return rows.filter((m): m is Match => m !== undefined)
  },

  countByUpload: (uploadId) => db.matches.where('uploadId').equals(uploadId).count(),

  async listTeamsByLeague() {
    const teams = new Map<string, Set<string>>()
    await db.matches.each((m) => {
      if (!m.league) return
      const set = teams.get(m.league) ?? new Set<string>()
      set.add(m.home).add(m.away)
      teams.set(m.league, set)
    })
    return Object.fromEntries([...teams].sort(([a], [b]) => a.localeCompare(b, 'tr')).map(([league, set]) => [league, [...set].sort((a, b) => a.localeCompare(b, 'tr'))]))
  },

  async upsertMany(matches) {
    await db.matches.bulkPut(matches)
  },

  async update(id, patch) {
    await db.matches.update(id, patch)
  },

  async remove(id) {
    await db.transaction('rw', db.matches, db.results, db.picks, db.aiVerdicts, async () => {
      await db.picks.where('matchId').equals(id).delete()
      await db.aiVerdicts.where('matchId').equals(id).delete()
      await db.results.delete(id)
      await db.matches.delete(id)
    })
  },
}
