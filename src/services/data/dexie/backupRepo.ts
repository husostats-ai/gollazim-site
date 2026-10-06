import type { BackupRepo } from '../types'
import { db } from './db'
import { settingsRepo } from './settingsRepo'
import { isCategoryId } from '../../../config/categories'
import { normalizeSelections } from '../../story/selection'
import { normalizeShared } from '../../story/shared'

export const backupRepo: BackupRepo = {
  async exportAll() {
    const [uploads, matches, results, picks, thresholds, aiVerdicts, aiPrompts, storyTexts, marketConflictLimit, storySelections, sharedPicks] =
      await Promise.all([
      db.uploads.toArray(),
      db.matches.toArray(),
      db.results.toArray(),
      db.picks.toArray(),
      settingsRepo.getThresholds(),
      db.aiVerdicts.toArray(),
      db.aiPrompts.toArray(),
      settingsRepo.getStoryTexts(),
      settingsRepo.getMarketConflictLimit(),
      db.storySelections.toArray(),
      db.sharedPicks.toArray(),
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
      storyTexts,
      marketConflictLimit,
      storySelections,
      sharedPicks,
    }
  },

  async importAll(backup) {
    const tables = [db.uploads, db.matches, db.results, db.picks, db.settings, db.aiVerdicts, db.aiPrompts, db.storySelections, db.sharedPicks]
    await db.transaction('rw', tables, async () => {
      await Promise.all([
        db.uploads.clear(),
        db.matches.clear(),
        db.results.clear(),
        db.picks.clear(),
        db.settings.clear(),
        db.aiVerdicts.clear(),
        db.aiPrompts.clear(),
        db.storySelections.clear(),
        db.sharedPicks.clear(),
      ])
      await db.uploads.bulkPut(backup.uploads)
      await db.matches.bulkPut(backup.matches)
      await db.results.bulkPut(backup.results)
      await db.picks.bulkPut(backup.picks)
      await settingsRepo.setThresholds(backup.thresholds)
      // Eski yedeklerde görsel metinleri yoktur; o zaman varsayılanlara dönülür.
      if (backup.storyTexts) await settingsRepo.setStoryTexts(backup.storyTexts)
      if (backup.marketConflictLimit !== undefined) await settingsRepo.setMarketConflictLimit(backup.marketConflictLimit)
      // Yapay zekâ kayıtları olmayan eski yedekler de geçerlidir.
      await db.aiVerdicts.bulkPut(backup.aiVerdicts ?? [])
      await db.aiPrompts.bulkPut(backup.aiPrompts ?? [])
      // Seçimi olmayan eski yedeklerde hiçbir maç seçili gelmez.
      await db.storySelections.bulkPut(normalizeSelections(backup.storySelections, isCategoryId))
      await db.sharedPicks.bulkPut(normalizeShared(backup.sharedPicks, isCategoryId))
    })
  },
}
