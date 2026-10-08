import type { BackupRepo } from '../types'
import { db } from './db'
import { LAST_BACKUP_KEY, settingsRepo } from './settingsRepo'
import { assembleBackup } from '../backupFormat'
import { isCategoryId } from '../../../config/categories'
import { normalizeSelections } from '../../story/selection'
import { normalizeShared } from '../../story/shared'
import { normalizeAliases, normalizeLeagueTables } from '../../league/matching'
import { normalizeHighlights } from '../../highlights/highlights'
import { normalizeAiShares } from '../../ai/memberShare'

export const backupRepo: BackupRepo = {
  async exportAll() {
    const [uploads, matches, results, picks, thresholds, aiVerdicts, aiPrompts, storyTexts, marketConflictLimit, storySelections, sharedPicks, leagueTables, teamAliases, highlights, aiShares] =
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
      db.leagueTables.toArray(),
      db.teamAliases.toArray(),
      db.highlights.toArray(),
      db.aiShares.toArray(),
    ])
    return assembleBackup({ uploads, matches, results, picks, thresholds, aiVerdicts, aiPrompts, storyTexts, marketConflictLimit, storySelections, sharedPicks, leagueTables, teamAliases, highlights, aiShares }, new Date())
  },

  async importAll(backup) {
    const tables = [db.uploads, db.matches, db.results, db.picks, db.settings, db.aiVerdicts, db.aiPrompts, db.storySelections, db.sharedPicks, db.leagueTables, db.teamAliases, db.highlights, db.aiShares]
    await db.transaction('rw', tables, async () => {
      // Son yedek zamanı bu tarayıcıya aittir: yedekten gelmez, içe aktarma da onu silmez.
      const lastBackup = await db.settings.get(LAST_BACKUP_KEY)
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
        db.leagueTables.clear(),
        db.teamAliases.clear(),
        db.highlights.clear(),
        db.aiShares.clear(),
      ])
      await db.uploads.bulkPut(backup.uploads)
      await db.matches.bulkPut(backup.matches)
      await db.results.bulkPut(backup.results)
      await db.picks.bulkPut(backup.picks)
      if (lastBackup) await db.settings.put(lastBackup)
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
      await db.leagueTables.bulkPut(normalizeLeagueTables(backup.leagueTables))
      await db.teamAliases.bulkPut(normalizeAliases(backup.teamAliases))
      // Seçimi olmayan eski yedeklerde öne çıkan gelmez.
      await db.highlights.bulkPut(normalizeHighlights(backup.highlights, isCategoryId))
      await db.aiShares.bulkPut(normalizeAiShares(backup.aiShares))
    })
  },
}
