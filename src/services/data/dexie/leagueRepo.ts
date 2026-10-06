import type { LeagueRepo } from '../types'
import { db } from './db'

export const leagueRepo: LeagueRepo = {
  listTables: () => db.leagueTables.toArray(),

  async saveTable(table) {
    await db.leagueTables.put(table)
  },

  listAliases: () => db.teamAliases.toArray(),

  async saveAliases(aliases) {
    await db.teamAliases.bulkPut(aliases)
  },

  async removeAlias(id) {
    await db.teamAliases.delete(id)
  },
}
