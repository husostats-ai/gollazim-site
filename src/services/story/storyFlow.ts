import type { Match, SharedPick } from '../../types'

// Kategori Story görselinin iki adımı. Önizleme yalnızca görseli üretir ve hiçbir
// kayıt oluşturmaz; "paylaşıldı" kaydı yalnızca indirme anında açılır.

export interface StoryFlowDeps {
  /** PNG'yi üretir */
  render: () => Promise<Blob>
  /** Maçları paylaşıldı olarak kaydeder; yeni açılan kayıtları döner */
  record: (matches: Match[]) => Promise<SharedPick[]>
}

export interface StoryPreview {
  blob: Blob
  /** Önizlenen görseldeki maçlar; indirme anında tam olarak bunlar kaydedilir */
  matches: Match[]
}

export interface DownloadResult {
  /** Bu indirmeyle ilk kez (ya da çıkarıldıktan sonra yeniden) kaydedilen maç sayısı */
  added: number
  /** Bunlardan, maç başladıktan sonra kaydedilenler */
  late: number
}

/** Önizleme: görsel üretilir, kayıt yapılmaz. */
export async function previewStory(deps: Pick<StoryFlowDeps, 'render'>, matches: Match[]): Promise<StoryPreview> {
  return { blob: await deps.render(), matches: [...matches] }
}

/** İndirme: önizlenen görseldeki maçlar paylaşıldı olarak kaydedilir; maç sonrası işareti bu ana göre konur. */
export async function downloadStory(deps: Pick<StoryFlowDeps, 'record'>, preview: StoryPreview): Promise<DownloadResult> {
  const added = await deps.record(preview.matches)
  return { added: added.length, late: added.filter((r) => r.afterKickoff).length }
}
