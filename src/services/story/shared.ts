import type { CategoryId } from '../../config/categories'
import type { Match, Pick, SharedPick } from '../../types'
import { toAppDateTime } from '../../utils/date'

// "Paylaşılan öneriler" kaydı: bir kategori Story görseli indirildiğinde
// görseldeki maçlar kalıcı olarak paylaşıldı diye işaretlenir (önizleme kayıt açmaz). Görsele ekle
// seçiminden ayrıdır (o geçicidir) ve önerileri, dondurmayı ya da tüm öneriler
// üzerinden yapılan istatistikleri değiştirmez.

/** Aynı gün + kategori + maç birden çok kez paylaşılıp çıkarılabildiği için kimlikte zaman damgası da vardır */
export const sharedId = (date: string, categoryId: CategoryId, matchId: string, sharedAt: string): string =>
  [date, categoryId, matchId, sharedAt].join('|')

const keyOf = (record: { date: string; categoryId: CategoryId; matchId: string }): string =>
  [record.date, record.categoryId, record.matchId].join('|')

export const isActive = (record: SharedPick): boolean => record.removedAt === undefined

/** Çıkarılmamış (geçerli) paylaşım kayıtları */
export const activeShared = (records: SharedPick[]): SharedPick[] => records.filter(isActive)

/** Maçın bu kategorideki geçerli paylaşım kaydı; yoksa undefined */
export const findActiveShared = (records: SharedPick[], date: string, categoryId: CategoryId, matchId: string): SharedPick | undefined =>
  records.find((r) => isActive(r) && r.date === date && r.categoryId === categoryId && r.matchId === matchId)

/** Türkiye saati yıl boyu UTC+3'tür */
const APP_UTC_OFFSET = '+03:00'

/**
 * Kayıt anında maç başlamış mıydı. Saat biliniyorsa başlama anıyla, bilinmiyorsa
 * yalnızca günle karşılaştırılır (maç günü geçtiyse başlamış sayılır).
 */
export function isAfterKickoff(match: Pick_<Match, 'date' | 'time'>, now: string): boolean {
  const instant = new Date(now)
  if (match.time && /^\d{2}:\d{2}$/.test(match.time)) {
    return instant.getTime() >= new Date(`${match.date}T${match.time}:00${APP_UTC_OFFSET}`).getTime()
  }
  return toAppDateTime(instant).date > match.date
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

/**
 * Bir görsel indirmesi için eklenecek yeni kayıtlar. Zaten geçerli kaydı olan maç
 * yeniden eklenmez (paylaşılanlar birleşir, ilk paylaşım zamanı korunur); görselde
 * olmayan maçlar da paylaşılandan çıkmaz. Daha önce çıkarılmış bir maç yeniden
 * paylaşılırsa eski kayıt geçmişte kalır, yeni bir kayıt açılır.
 */
export function recordShare(
  existing: SharedPick[],
  share: { date: string; categoryId: CategoryId; matches: Pick_<Match, 'id' | 'date' | 'time'>[]; now: string },
): SharedPick[] {
  const { date, categoryId, matches, now } = share
  const added = new Map<string, SharedPick>()
  for (const match of matches) {
    if (findActiveShared(existing, date, categoryId, match.id) || added.has(match.id)) continue
    added.set(match.id, {
      id: sharedId(date, categoryId, match.id, now),
      date,
      categoryId,
      matchId: match.id,
      sharedAt: now,
      afterKickoff: isAfterKickoff(match, now),
    })
  }
  return [...added.values()]
}

/** Geçerli kaydı "çıkarıldı" olarak işaretler; kayıt silinmez. Geçerli kayıt yoksa liste aynen döner. */
export function removeShare(records: SharedPick[], date: string, categoryId: CategoryId, matchId: string, now: string): SharedPick[] {
  const target = findActiveShared(records, date, categoryId, matchId)
  return target ? records.map((r) => (r === target ? { ...r, removedAt: now } : r)) : records
}

/** Dondurulmuş önerilerden, geçerli paylaşım kaydı olanlar (gün + kategori + maç eşleşmesi) */
export function sharedPicksOnly(picks: Pick[], records: SharedPick[]): Pick[] {
  const keys = new Set(activeShared(records).map(keyOf))
  return picks.filter((p) => keys.has(keyOf(p)))
}

/**
 * Paylaşılmış, skoru "tamamlandı" girilmiş ama dondurulmuş önerisi olmayan kayıt sayısı
 * (ör. paylaşımdan sonra eşik değişti ve maç skor girilirken listede değildi). Bunlar hiçbir sayıma girmez.
 */
export function sharedWithoutPick(records: SharedPick[], picks: Pick[], completedMatchIds: ReadonlySet<string>): number {
  const frozen = new Set(picks.map(keyOf))
  return activeShared(records).filter((r) => completedMatchIds.has(r.matchId) && !frozen.has(keyOf(r))).length
}

/** Yedekten gelen kayıtları doğrular; bozuk satırlar atılır. Çıkarılmış kayıtlar (geçmiş) korunur. */
export function normalizeShared(value: unknown, isCategory: (id: string) => id is CategoryId): SharedPick[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, SharedPick>()
  for (const row of value as Partial<SharedPick>[]) {
    if (typeof row !== 'object' || row === null) continue
    const { date, categoryId, matchId, sharedAt, afterKickoff, removedAt } = row
    if (typeof date !== 'string' || typeof matchId !== 'string' || typeof sharedAt !== 'string') continue
    if (typeof categoryId !== 'string' || !isCategory(categoryId)) continue
    const id = sharedId(date, categoryId, matchId, sharedAt)
    byId.set(id, {
      id,
      date,
      categoryId,
      matchId,
      sharedAt,
      afterKickoff: afterKickoff === true,
      ...(typeof removedAt === 'string' && { removedAt }),
    })
  }
  return [...byId.values()]
}

export type StatsScope = 'shared' | 'all'

export const SCOPE_LABELS: Record<StatsScope, string> = { shared: 'Paylaşılan öneriler', all: 'Tüm öneriler' }
