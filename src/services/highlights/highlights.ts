import type { CategoryId } from '../../config/categories'
import type { Highlight, Match, MatchResult, Pick, PickOutcome } from '../../types'
import type { ReliabilityLevel } from '../analysis/types'
import { evaluatePick } from '../results/evaluator'

// "Günün öne çıkanları": admin'in maç başlamadan önce elle işaretlediği öneriler (gün + maç + kategori).
// Saf fonksiyonlardır. Önerileri, dondurmayı, eşikleri, yıldızları ve istatistikleri değiştirmez;
// üye paketine ve üye sitesine girmez. Sonuç için yeni hesap yoktur: dondurulmuş önerinin sonucu,
// o yoksa aynı değerlendirme fonksiyonu (evaluatePick) kullanılır.
//
// Kilit: maçın başlama saati geldiği anda seçim kilitlenir; kilitli satır eklenemez ve silinemez.
// Saati bilinmeyen maç hiç eklenemez (geriye dönük ekleme kapalıdır).

export const highlightId = (date: string, matchId: string, categoryId: CategoryId): string => [date, matchId, categoryId].join('|')

/** Türkiye saati yıl boyu UTC+3'tür */
const APP_UTC_OFFSET = '+03:00'
const TIME = /^\d{2}:\d{2}$/

/** open: eklenebilir / kaldırılabilir. locked: maç başladı. no-time: başlama saati bilinmiyor */
export type LockState = 'open' | 'locked' | 'no-time'

/** Maçın başlama anı (Türkiye saatiyle); saat bilinmiyorsa null */
export function kickoffOf(match: { date: string; time?: string | null }): Date | null {
  if (!match.time || !TIME.test(match.time)) return null
  const kickoff = new Date(`${match.date}T${match.time}:00${APP_UTC_OFFSET}`)
  return Number.isNaN(kickoff.getTime()) ? null : kickoff
}

/** Başlama saati geldiği an (o an dahil) kilitlidir */
export function lockState(match: { date: string; time?: string | null }, now: Date): LockState {
  const kickoff = kickoffOf(match)
  if (!kickoff) return 'no-time'
  return now.getTime() >= kickoff.getTime() ? 'locked' : 'open'
}

/** Eklenecek önerinin kayda yazılan görünümü */
export interface HighlightCandidate {
  match: Pick_<Match, 'id' | 'date' | 'time' | 'league' | 'home' | 'away'>
  categoryId: CategoryId
  percent: number
  reliability?: ReliabilityLevel
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

export type HighlightRefusal = 'locked' | 'no-time' | 'exists' | 'missing'
export const REFUSAL_TEXTS: Record<HighlightRefusal, string> = {
  locked: 'Maç başladı; seçim kilitli.',
  'no-time': 'Maçın saati bilinmiyor; öne çıkanlara eklenemez.',
  exists: 'Bu öneri zaten öne çıkanlarda.',
  missing: 'Bu öneri öne çıkanlarda değil.',
}

export type AddResult = { ok: true; record: Highlight } | { ok: false; reason: HighlightRefusal }

/** Öneriyi öne çıkanlara ekler; maç başladıysa, saati yoksa ya da zaten ekliyse reddeder */
export function addHighlight(existing: readonly Highlight[], candidate: HighlightCandidate, now: Date): AddResult {
  const { match, categoryId } = candidate
  const state = lockState(match, now)
  if (state !== 'open') return { ok: false, reason: state }
  const id = highlightId(match.date, match.id, categoryId)
  if (existing.some((h) => h.id === id)) return { ok: false, reason: 'exists' }
  return {
    ok: true,
    record: {
      id,
      date: match.date,
      matchId: match.id,
      categoryId,
      addedAt: now.toISOString(),
      home: match.home,
      away: match.away,
      time: match.time!,
      ...(match.league !== undefined && { league: match.league }),
      percent: candidate.percent,
      ...(candidate.reliability !== undefined && { reliability: candidate.reliability }),
    },
  }
}

export type RemoveResult = { ok: true; record: Highlight } | { ok: false; reason: HighlightRefusal }

/** Kaldırılacak kaydı verir; maç başladıysa reddeder. Kilit, kayıttaki gün ve saatten okunur (maç silinmiş olabilir) */
export function removeHighlight(existing: readonly Highlight[], id: string, now: Date): RemoveResult {
  const record = existing.find((h) => h.id === id)
  if (!record) return { ok: false, reason: 'missing' }
  // Saati okunamayan kayıt kilitli sayılır: ne zaman başladığı bilinmeyen seçim silinemez.
  if (lockState(record, now) !== 'open') return { ok: false, reason: 'locked' }
  return { ok: true, record }
}

/**
 * Seçimin sonucu: dondurulmuş öneri varsa onun sonucu; yoksa girilmiş skor aynı değerlendirme
 * fonksiyonundan geçirilir. Skor girilmediyse 'pending'.
 */
export function highlightOutcome(record: Pick_<Highlight, 'categoryId'>, pick: Pick | undefined, result: MatchResult | undefined): PickOutcome {
  if (pick) return pick.outcome
  return result ? evaluatePick(record.categoryId, result) : 'pending'
}

export interface HighlightSummary {
  selected: number
  won: number
  lost: number
  /** Skoru girilmemiş ya da maçı tamamlanmamış */
  pending: number
  /** Maç tamamlandı ama kategori için gereken veri girilmedi */
  void: number
}

/** Yalnızca verilen seçimlerin sayımı: seçilen = tutan + tutmayan + bekleyen + değerlendirilemeyen */
export function summarizeHighlights(outcomes: readonly PickOutcome[]): HighlightSummary {
  const count = (outcome: PickOutcome) => outcomes.filter((o) => o === outcome).length
  return { selected: outcomes.length, won: count('won'), lost: count('lost'), pending: count('pending'), void: count('void') }
}

/** Listede saat sırası; aynı saatte ev sahibi adı, sonra kategori */
export const byKickoffTime = (a: Highlight, b: Highlight): number => a.time.localeCompare(b.time) || a.home.localeCompare(b.home, 'tr') || a.id.localeCompare(b.id)

const RELIABILITY_LEVELS: readonly ReliabilityLevel[] = ['low', 'medium', 'high', 'unknown', 'unmeasured', 'market', 'market-partial']

/** Yedekten gelen kayıtları doğrular; bozuk satırlar atılır, yinelenen kimlikte son satır kalır */
export function normalizeHighlights(value: unknown, isCategory: (id: string) => id is CategoryId): Highlight[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, Highlight>()
  for (const row of value as Partial<Highlight>[]) {
    if (typeof row !== 'object' || row === null) continue
    const { date, matchId, categoryId, addedAt, home, away, time, league, percent, reliability } = row
    if (typeof date !== 'string' || typeof matchId !== 'string' || typeof addedAt !== 'string' || Number.isNaN(Date.parse(addedAt))) continue
    if (typeof categoryId !== 'string' || !isCategory(categoryId)) continue
    if (typeof home !== 'string' || typeof away !== 'string' || typeof time !== 'string' || !TIME.test(time)) continue
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
    const id = highlightId(date, matchId, categoryId)
    byId.set(id, {
      id,
      date,
      matchId,
      categoryId,
      addedAt,
      home,
      away,
      time,
      ...(typeof league === 'string' && { league }),
      percent,
      ...(typeof reliability === 'string' && RELIABILITY_LEVELS.includes(reliability) && { reliability }),
    })
  }
  return [...byId.values()]
}
