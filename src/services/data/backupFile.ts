import type { BackupFile } from '../../types'
import { isBackupFile } from './backupFormat'
import { backupFileName, requestPersistence, restoreBackupFlow, saveBackupFile, type PersistenceStatus, type RestoreOutcome, type SaveOutcome, type SaveTarget, type WritableLike } from './backupFlow'
import { backupRepo, settingsRepo } from './index'

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<WritableLike> }>

/**
 * Tarayıcının kaydetme yolları. showSaveFilePicker varsa (Chrome, Edge) dosya penceresi kullanılır ve
 * yazmanın bittiği bilinir; yoksa (Firefox, Safari, varsayılan Brave) dosya indirilir ve kullanıcıya sorulur.
 */
export function browserSaveTarget(): SaveTarget {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return {
    pickFile:
      typeof picker === 'function'
        ? async (suggestedName) => {
            const handle = await picker.call(window, { suggestedName, types: [{ description: 'GOLLAZIM yedeği', accept: { 'application/json': ['.json'] } }] })
            return handle.createWritable()
          }
        : undefined,
    download: (name, blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    },
    confirmSaved: (name) =>
      window.confirm(`"${name}" dosyasını kaydettin mi?\n\nDosya bilgisayarına indiyse "Tamam"a bas: son yedek zamanı ancak o zaman güncellenir. İndirme iptal edildiyse ya da emin değilsen "İptal"e bas.`),
  }
}

const markSaved = (at: string) => settingsRepo.setLastBackupAt(at)

/** Tarayıcıdaki verinin yedeğini kaydeder; son yedek zamanı yalnızca kayıt kesinleşince yazılır. */
export async function saveBackup(): Promise<SaveOutcome> {
  const backup = await backupRepo.exportAll()
  return saveBackupFile(backup, backupFileName(backup), browserSaveTarget(), markSaved)
}

/** Kaydetme sonucunun kullanıcıya gösterilen metni */
export const SAVE_OUTCOME_TEXT: Record<SaveOutcome, string> = {
  saved: 'Yedek kaydedildi.',
  confirmed: 'Yedek indirildi; kaydettiğini onayladın.',
  cancelled: 'Yedek kaydedilmedi; son yedek zamanı değişmedi.',
}

/** Dosyayı okur ve doğrular; geçersizse hata fırlatır. */
export async function readBackupFile(file: File): Promise<BackupFile> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Dosya okunamadı: geçerli bir JSON değil.')
  }
  if (!isBackupFile(data)) {
    throw new Error('Bu dosya bir GOLLAZIM yedeği değil veya sürümü desteklenmiyor.')
  }
  return data
}

/** Dosyayı doğrular, gerekirse uyarır ve güvenlik yedeği aldırır, ardından mevcut verinin yerine yazar. */
export async function restoreBackup(file: File): Promise<RestoreOutcome> {
  const backup = await readBackupFile(file)
  return restoreBackupFlow(backup, {
    exportCurrent: () => backupRepo.exportAll(),
    importAll: (b) => backupRepo.importAll(b),
    markSaved,
    confirm: (text) => window.confirm(text),
    target: browserSaveTarget(),
  })
}

let persistence: Promise<PersistenceStatus> | null = null

/** Kalıcı depoyu bir kez ister (uygulama açılışında); sonraki çağrılar aynı sonucu döndürür. */
export function ensurePersistence(): Promise<PersistenceStatus> {
  persistence ??= requestPersistence(typeof navigator === 'undefined' ? undefined : navigator.storage)
  return persistence
}
