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
    ['aiVerdicts', 'aiPrompts'].every((k) => d[k] === undefined || Array.isArray(d[k])) &&
    (d.storyTexts === undefined || (typeof d.storyTexts === 'object' && d.storyTexts !== null))
  )
}
