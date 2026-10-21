import type { BackupFile } from '../../types'

// Yedek alma ve geri yükleme akışı. Tarayıcıya ve veritabanına bağlı değildir: kaydetme, onay ve
// veritabanı işlemleri dışarıdan verilir (tarayıcı karşılıkları backupFile.ts'te). Böylece "son yedek
// zamanı yalnızca yazma gerçekten bitince kaydedilir" kuralı test edilebilir.

/** Kalıcı depo (navigator.storage.persist) durumu */
export type PersistenceStatus = 'granted' | 'denied' | 'unsupported'

export const PERSISTENCE_LABELS: Record<PersistenceStatus, string> = {
  granted: 'verildi',
  denied: 'verilmedi',
  unsupported: 'desteklenmiyor',
}

export const PERSISTENCE_NOTE =
  'Kalıcı depo bir garanti değildir: tarayıcı verisini elle temizlemek ya da profili silmek veriyi yine siler. Düzenli yedek almaya devam edin.'

/** navigator.storage'ın kullanılan kısmı (testte sahtesi verilir) */
export interface StorageLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
}

/** Kalıcı depo ister; zaten verilmişse yeniden istemez. API yoksa ya da hata verirse 'unsupported'. */
export async function requestPersistence(storage: StorageLike | undefined): Promise<PersistenceStatus> {
  if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') return 'unsupported'
  try {
    if (await storage.persisted()) return 'granted'
    return (await storage.persist()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** Dosyanın yazıldığı akış (showSaveFilePicker → createWritable) */
export interface WritableLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

/** Yedeği diske bırakmanın yolları */
export interface SaveTarget {
  /** Dosya kaydetme penceresi (showSaveFilePicker); tarayıcı desteklemiyorsa yok. İptalde AbortError fırlatır. */
  pickFile?: (suggestedName: string) => Promise<WritableLike>
  /** İndirilenler klasörüne indirme (yazmanın bittiği bilinemez) */
  download: (name: string, blob: Blob) => void
  /** İndirmeden sonra kullanıcıya "kaydettin mi?" sorusu */
  confirmSaved: (name: string) => boolean | Promise<boolean>
}

/** saved: dosya penceresiyle yazıldı. confirmed: indirildi, kullanıcı kaydettiğini onayladı. cancelled: kaydedilmedi. */
export type SaveOutcome = 'saved' | 'confirmed' | 'cancelled'

const isAbort = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

export const backupFileName = (backup: BackupFile, suffix = ''): string => `gollazim-yedek-${backup.exportedAt.slice(0, 10)}${suffix}.json`

/**
 * Yedeği kaydeder. Son yedek zamanı (markSaved) YALNIZCA dosya gerçekten yazıldığında ya da kullanıcı
 * indirilen dosyayı kaydettiğini onayladığında yazılır; iptalde değişmez. Yazma hatası olduğu gibi fırlatılır.
 */
export async function saveBackupFile(backup: BackupFile, name: string, target: SaveTarget, markSaved: (at: string) => Promise<void>): Promise<SaveOutcome> {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  if (target.pickFile) {
    let writable: WritableLike
    try {
      writable = await target.pickFile(name)
    } catch (error) {
      if (isAbort(error)) return 'cancelled'
      throw error
    }
    await writable.write(blob)
    await writable.close()
    await markSaved(backup.exportedAt)
    return 'saved'
  }
  target.download(name, blob)
  if (!(await target.confirmSaved(name))) return 'cancelled'
  await markSaved(backup.exportedAt)
  return 'confirmed'
}

/** Yedeğin içindeki en son kayıt anı (yükleme, skor, dondurma, yapay zekâ kararı) ve en son maç günü */
export interface BackupRecency {
  /** ISO an; hiç kayıt yoksa null */
  latestAt: string | null
  /** YYYY-MM-DD; hiç maç yoksa null */
  latestMatchDay: string | null
}

const maxOf = (values: (string | undefined)[]): string | null => {
  let best: string | null = null
  let bestTime = -Infinity
  for (const value of values) {
    const time = value ? Date.parse(value) : NaN
    if (!Number.isNaN(time) && time > bestTime) {
      best = value!
      bestTime = time
    }
  }
  return best
}

export function backupRecency(backup: Pick<BackupFile, 'uploads' | 'matches' | 'results' | 'picks' | 'aiVerdicts'>): BackupRecency {
  return {
    latestAt: maxOf([...backup.uploads.map((u) => u.uploadedAt), ...backup.results.map((r) => r.updatedAt), ...backup.picks.map((p) => p.frozenAt), ...(backup.aiVerdicts ?? []).map((v) => v.savedAt)]),
    latestMatchDay: backup.matches.reduce<string | null>((latest, m) => (latest === null || m.date > latest ? m.date : latest), null),
  }
}

/** Tarayıcıda içe aktarmanın üzerine yazacağı veri var mı */
export const hasData = (backup: Pick<BackupFile, 'uploads' | 'matches' | 'results' | 'picks'>): boolean =>
  backup.uploads.length > 0 || backup.matches.length > 0 || backup.results.length > 0 || backup.picks.length > 0

/** Yüklenen yedek tarayıcıdaki veriden eski mi (en son kayıt anına göre; maç günü eşitliği bozar) */
export function isOlderBackup(incoming: BackupRecency, current: BackupRecency): boolean {
  if (current.latestAt === null) return false
  if (incoming.latestAt === null) return true
  const diff = Date.parse(incoming.latestAt) - Date.parse(current.latestAt)
  if (diff !== 0) return diff < 0
  return (incoming.latestMatchDay ?? '') < (current.latestMatchDay ?? '')
}

const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : 'kayıt yok')

export const REPLACE_TEXT = 'Tarayıcıdaki mevcut verinin tamamı bu yedekle değiştirilecek. Önce mevcut verinin bir güvenlik yedeği alınacak. Devam edilsin mi?'

export function olderText(incoming: BackupRecency, current: BackupRecency): string {
  return (
    `Dikkat: yüklenen yedek tarayıcıdaki veriden ESKİ. Yedekteki son kayıt ${dayOf(incoming.latestAt)} (son maç günü ${incoming.latestMatchDay ?? 'yok'}), ` +
    `tarayıcıdaki son kayıt ${dayOf(current.latestAt)} (son maç günü ${current.latestMatchDay ?? 'yok'}). Aradaki kayıtlar silinir. Yine de devam edilsin mi?`
  )
}

export interface RestoreDeps {
  /** Tarayıcıdaki mevcut verinin yedeği */
  exportCurrent: () => Promise<BackupFile>
  importAll: (backup: BackupFile) => Promise<void>
  markSaved: (at: string) => Promise<void>
  confirm: (text: string) => boolean | Promise<boolean>
  target: SaveTarget
}

export type RestoreOutcome = { kind: 'restored'; backup: BackupFile; safety: SaveOutcome | 'skipped' } | { kind: 'cancelled'; reason: string }

/**
 * Doğrulanmış bir yedeği geri yükler: yedek eskiyse ayrıca uyarır, değiştirme onayı ister, tarayıcıda
 * veri varsa önce onun güvenlik yedeğini kaydettirir (aynı kaydetme akışı). Güvenlik yedeği kaydedilmezse
 * içe aktarma yapılmaz.
 */
export async function restoreBackupFlow(incoming: BackupFile, deps: RestoreDeps): Promise<RestoreOutcome> {
  const current = await deps.exportCurrent()
  const incomingRecency = backupRecency(incoming)
  const currentRecency = backupRecency(current)
  if (isOlderBackup(incomingRecency, currentRecency) && !(await deps.confirm(olderText(incomingRecency, currentRecency))))
    return { kind: 'cancelled', reason: 'Eski yedek yüklenmedi; tarayıcıdaki veri değişmedi.' }
  if (!(await deps.confirm(REPLACE_TEXT))) return { kind: 'cancelled', reason: 'İçe aktarma iptal edildi; tarayıcıdaki veri değişmedi.' }
  let safety: SaveOutcome | 'skipped' = 'skipped'
  if (hasData(current)) {
    safety = await saveBackupFile(current, backupFileName(current, '-ice-aktarma-oncesi'), deps.target, deps.markSaved)
    if (safety === 'cancelled') return { kind: 'cancelled', reason: 'Güvenlik yedeği kaydedilmediği için içe aktarma yapılmadı; tarayıcıdaki veri değişmedi.' }
  }
  await deps.importAll(incoming)
  return { kind: 'restored', backup: incoming, safety }
}
