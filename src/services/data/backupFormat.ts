import type { BackupFile } from '../../types'

/**
 * Dosyanın bir GOLLAZIM yedeği olup olmadığını denetler. Yapay zekâ alanları
 * (aiVerdicts, aiPrompts) isteğe bağlıdır: bu özellikten önce alınmış yedekler de geçerlidir.
 */
export const isBackupFile = (data: unknown): data is BackupFile => {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    d.app === 'gollazim' &&
    d.version === 1 &&
    ['uploads', 'matches', 'results', 'picks'].every((k) => Array.isArray(d[k])) &&
    typeof d.thresholds === 'object' &&
    d.thresholds !== null &&
    ['aiVerdicts', 'aiPrompts', 'storySelections', 'sharedPicks'].every((k) => d[k] === undefined || Array.isArray(d[k])) &&
    (d.storyTexts === undefined || (typeof d.storyTexts === 'object' && d.storyTexts !== null)) &&
    (d.marketConflictLimit === undefined || typeof d.marketConflictLimit === 'number')
  )
}

/** Yedek dosyasına giren alanlar. Tarayıcıya özgü kayıtlar (ör. son yedek zamanı) burada yoktur. */
export type BackupContent = Omit<BackupFile, 'app' | 'version' | 'exportedAt'>

/** Yedek dosyasının içeriğini kurar; yalnızca BackupContent alanları yazılır. */
export const assembleBackup = (content: BackupContent, now: Date): BackupFile => ({
  app: 'gollazim',
  version: 1,
  exportedAt: now.toISOString(),
  uploads: content.uploads,
  matches: content.matches,
  results: content.results,
  picks: content.picks,
  thresholds: content.thresholds,
  aiVerdicts: content.aiVerdicts,
  aiPrompts: content.aiPrompts,
  storyTexts: content.storyTexts,
  marketConflictLimit: content.marketConflictLimit,
  storySelections: content.storySelections,
  sharedPicks: content.sharedPicks,
})
