import type { BackupFile } from '../../types'
import { isBackupFile } from './backupFormat'
import { backupRepo, settingsRepo } from './index'

export async function downloadBackup(): Promise<void> {
  const backup = await backupRepo.exportAll()
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gollazim-yedek-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  // Hatırlatıcı için: son yedek zamanı yalnızca bu tarayıcıda tutulur, yedek dosyasına girmez.
  await settingsRepo.setLastBackupAt(backup.exportedAt)
}

/** Dosyayı doğrular ve mevcut verinin yerine yazar; geçersizse hata fırlatır. */
export async function restoreBackup(file: File): Promise<BackupFile> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Dosya okunamadı: geçerli bir JSON değil.')
  }
  if (!isBackupFile(data)) {
    throw new Error('Bu dosya bir GOLLAZIM yedeği değil veya sürümü desteklenmiyor.')
  }
  await backupRepo.importAll(data)
  return data
}
