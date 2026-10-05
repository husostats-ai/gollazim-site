import type { BackupRepo } from '../types'
import { db } from './db'
import { settingsRepo } from './settingsRepo'

export const backupRepo: BackupRepo = {
  async exportAll() {
    const [uploads, matches, results, picks, thresholds, aiVerdicts, aiPrompts] = await Promise.all([
      db.uploads.toArray(),
      db.matches.toArray(),
      db.results.toArray(),
      db.picks.toArray(),
      settingsRepo.getThresholds(),
      db.aiVerdicts.toArray(),
      db.aiPrompts.toArray(),
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
      aiVerdicts,
      aiPrompts,
    }
  },

  async importAll(backup) {
    const tables = [db.uploads, db.matches, db.results, db.picks, db.settings, db.aiVerdicts, db.aiPrompts]
    await db.transaction('rw', tables, async () => {
      await Promise.all([
        db.uploads.clear(),
        db.matches.clear(),
        db.results.clear(),
        db.picks.clear(),
        db.settings.clear(),
        db.aiVerdicts.clear(),
        db.aiPrompts.clear(),
      ])
      await db.uploads.bulkPut(backup.uploads)
      await db.matches.bulkPut(backup.matches)
      await db.results.bulkPut(backup.results)
      await db.picks.bulkPut(backup.picks)
      await settingsRepo.setThresholds(backup.thresholds)
      // Yapay zekâ kayıtları olmayan eski yedekler de geçerlidir.
      await db.aiVerdicts.bulkPut(backup.aiVerdicts ?? [])
      await db.aiPrompts.bulkPut(backup.aiPrompts ?? [])
    })
  },
}
