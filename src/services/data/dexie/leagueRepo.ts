import type { LeagueRepo } from '../types'
import { db } from './db'
import { nextSnapshot } from '../../league/history'

export const leagueRepo: LeagueRepo = {
  listTables: () => db.leagueTables.toArray(),

  async saveTable(table) {
    await db.transaction('rw', db.leagueTables, db.leagueTableSnapshots, async () => {
      await db.leagueTables.put(table)
      const history = await db.leagueTableSnapshots.where('league').equals(table.league).toArray()
      await db.leagueTableSnapshots.put(nextSnapshot(history, table))
    })
  },

  listSnapshots: () => db.leagueTableSnapshots.toArray(),

  listAliases: () => db.teamAliases.toArray(),

  async saveAliases(aliases) {
    await db.teamAliases.bulkPut(aliases)
  },

  async removeAlias(id) {
    await db.teamAliases.delete(id)
  },
}
