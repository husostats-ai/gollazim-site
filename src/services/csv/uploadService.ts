import type { FieldKey } from '../../config/columnAliases'
import type { Upload } from '../../types'
import { matchesRepo, uploadsRepo } from '../data'
import { importCsv } from './importer'

export interface UploadSummary {
  upload: Upload
  added: number
  updated: number
  /** Elle düzenlendiği için CSV'deki değerlerle değiştirilmeyen maç sayısı */
  preserved: number
  dates: string[]
  warnings: string[]
  missingFields: FieldKey[]
}

/**
 * CSV dosyasını okur ve maçları kaydeder. Daha önce yüklenmiş bir maç
 * (aynı tarih ve takımlar) yeniden gelirse kopya oluşmaz, kayıt güncellenir
 * ve maç yeni yüklemeye bağlanır; girilmiş skorlar korunur. Admin panelinden
 * elle düzenlenmiş maçların değerleri değiştirilmez.
 */
export async function uploadCsvFile(file: File): Promise<UploadSummary> {
  const uploadId = crypto.randomUUID()
  const { matches, warnings, missingFields } = importCsv(await file.text(), uploadId)

  const existing = await matchesRepo.getMany(matches.map((m) => m.id))
  const editedIds = new Set(existing.filter((m) => m.edited).map((m) => m.id))
  // CSV yeniden yüklense de maçın kayıtlı skor anlık görüntüsü korunur.
  const snapshots = new Map(existing.filter((m) => m.scoreSnapshot).map((m) => [m.id, m.scoreSnapshot!]))
  await matchesRepo.upsertMany(
    matches.filter((m) => !editedIds.has(m.id)).map((m) => (snapshots.has(m.id) ? { ...m, scoreSnapshot: snapshots.get(m.id) } : m)),
  )
  await Promise.all([...editedIds].map((id) => matchesRepo.update(id, { uploadId })))
  const upload: Upload = {
    id: uploadId,
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
    matchCount: matches.length,
  }
  await uploadsRepo.add(upload)
  await syncUploadCounts(uploadId)

  return {
    upload,
    added: matches.length - existing.length,
    updated: existing.length - editedIds.size,
    preserved: editedIds.size,
    dates: [...new Set(matches.map((m) => m.date))].sort(),
    warnings,
    missingFields,
  }
}

/**
 * Yüklemelerin maç sayısını gerçek duruma getirir (maçlar yeni yüklemeye
 * geçmiş veya tek tek silinmiş olabilir); hiç maçı kalmayan yüklemeyi siler.
 */
export async function syncUploadCounts(keepUploadId?: string): Promise<void> {
  for (const upload of await uploadsRepo.list()) {
    if (upload.id === keepUploadId) continue
    const count = await matchesRepo.countByUpload(upload.id)
    if (count === 0) await uploadsRepo.remove(upload.id)
    else if (count !== upload.matchCount) await uploadsRepo.add({ ...upload, matchCount: count })
  }
}
