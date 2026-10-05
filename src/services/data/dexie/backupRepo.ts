import type { BackupRepo } from '../types'
import { db } from './db'
import { settingsRepo } from './settingsRepo'

export const backupRepo: BackupRepo = {
  async exportAll() {
    const [uploads, matches, results, picks, thresholds] = await Promise.all([
      db.uploads.toArray(),
      db.matches.toArray(),
      db.results.toArray(),
      db.picks.toArray(),
      settingsRepo.getThresholds(),
    ])
    return {
      app: 'gollazim',
      version: 1,
      exportedAt: new Date().toISOString(),
      uploads,
      matches,
      results,
      picks,
      thresholds,
    }
  },

  async importAll(backup) {
    await db.transaction('rw', [db.uploads, db.matches, db.results, db.picks, db.settings], async () => {
      await Promise.all([
        db.uploads.clear(),
        db.matches.clear(),
        db.results.clear(),
        db.picks.clear(),
        db.settings.clear(),
      ])
      await db.uploads.bulkPut(backup.uploads)
      await db.matches.bulkPut(backup.matches)
      await db.results.bulkPut(backup.results)
      await db.picks.bulkPut(backup.picks)
      await settingsRepo.setThresholds(backup.thresholds)
    })
  },
}
