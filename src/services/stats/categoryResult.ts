import { getCategory, type CategoryId } from '../../config/categories'
import type { Match, MatchResult, Pick, SharedPick } from '../../types'
import { secondHalfGoals } from '../results/evaluator'
import { activeShared, sharedPicksOnly, type StatsScope } from '../story/shared'
import { tally, type Tally } from './statsEngine'

// Bir günün tek bir kategorideki sonuç listesi (kategori sonuç görseli ve sonuç
// metni için). Yeni bir hesap içermez: her önerinin sonucu dondurma anında
// evaluator ile belirlenmiş outcome değeridir, özet de istatistik motorunun sayımıdır.

/** won: tuttu, lost: tutmadı, void: değerlendirilemedi / ertelendi / iptal, pending: skoru girilmedi */
export type ResultStatus = 'won' | 'lost' | 'void' | 'pending'

export const RESULT_LABELS: Record<ResultStatus, string> = {
  won: 'Tuttu',
  lost: 'Tutmadı',
  void: 'Değerlendirilemedi',
  pending: 'Bekliyor',
}

export interface CategoryResultRow {
  matchId: string
  home: string
  away: string
  time?: string
  league?: string
  status: ResultStatus
  /** Maç sonucu "2-1"; skor girilmediyse null */
  score: string | null
  /** Kategoriyle ilgili ek sayı: "İY 1-0", "2Y 1-1", "Korner 11", "Kart 5"; yoksa boş */
  detail: string
}

export interface CategoryResult {
  date: string
  categoryId: CategoryId
  scope: StatsScope
  /** Yalnızca kazandı + kaybetti orana girer; değerlendirilemedi ve bekleyen dışarıdadır */
  tally: Tally
  rows: CategoryResultRow[]
  /** Skoru girilmemiş (bekleyen) maç sayısı */
  unsettled: number
}

export interface CategoryResultInput {
  date: string
  categoryId: CategoryId
  scope: StatsScope
  /** Tüm dondurulmuş öneriler; gün ve kategoriye göre burada süzülür */
  picks: Pick[]
  shared: SharedPick[]
  /** Günün maçları (takım adları için) */
  matches: Match[]
  results: Record<string, MatchResult | undefined>
  /** "Tüm öneriler" ölçüsünde, şu an listede olup skoru girilmediği için dondurulmamış maçlar */
  recommendedIds?: string[]
}

const pair = (home: number | null, away: number | null): string | null => (home === null || away === null ? null : `${home}-${away}`)
const sum = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)

/** Kategoriye göre skorun yanında gösterilen ek sayı */
export function resultDetail(categoryId: CategoryId, result: MatchResult | undefined): string {
  if (!result || result.status !== 'completed') return ''
  const { group } = getCategory(categoryId)
  if (group === 'corners') {
    const corners = sum(result.cornersHome, result.cornersAway)
    return corners === null ? '' : `Korner ${corners}`
  }
  if (group === 'cards') {
    const cards = sum(result.cardsHome, result.cardsAway)
    return cards === null ? '' : `Kart ${cards}`
  }
  if (categoryId === 'ht05' || categoryId === 'ht15') {
    const half = pair(result.htHome, result.htAway)
    return half === null ? '' : `İY ${half}`
  }
  if (categoryId === 'sh05') {
    if (secondHalfGoals(result) === null) return ''
    return `2Y ${result.ftHome! - result.htHome!}-${result.ftAway! - result.htAway!}`
  }
  return ''
}

const statusOf = (pick: Pick | undefined, result: MatchResult | undefined): ResultStatus => {
  const halted = result?.status === 'postponed' || result?.status === 'cancelled'
  if (pick && pick.outcome !== 'pending') return pick.outcome
  if (halted) return 'void'
  // Skoru girilmiş ama dondurulmuş önerisi olmayan paylaşılan maç değerlendirilemez.
  if (!pick && result?.status === 'completed') return 'void'
  return 'pending'
}

/** Günün seçilen kategorideki sonuç listesi ve özeti. */
export function buildCategoryResult(input: CategoryResultInput): CategoryResult {
  const { date, categoryId, scope, matches, results } = input
  const ofCategory = input.picks.filter((p) => p.date === date && p.categoryId === categoryId)
  const dayShared = activeShared(input.shared).filter((r) => r.date === date && r.categoryId === categoryId)
  const scoped = scope === 'shared' ? sharedPicksOnly(ofCategory, dayShared) : ofCategory
  const byMatch = new Map(scoped.map((p) => [p.matchId, p]))
  const ids = new Set([
    ...scoped.map((p) => p.matchId),
    ...(scope === 'shared' ? dayShared.map((r) => r.matchId) : (input.recommendedIds ?? [])),
  ])
  const matchById = new Map(matches.map((m) => [m.id, m]))

  const rows: (CategoryResultRow & { percent: number })[] = [...ids].map((matchId) => {
    const pick = byMatch.get(matchId)
    const match = matchById.get(matchId)
    const result = results[matchId]
    const completed = result?.status === 'completed'
    return {
      matchId,
      home: match?.home ?? 'Maç kaydı silinmiş',
      away: match?.away ?? '',
      time: match?.time,
      league: match?.league,
      status: statusOf(pick, result),
      score: completed ? pair(result.ftHome, result.ftAway) : null,
      detail: resultDetail(categoryId, result),
      percent: pick?.percent ?? -1,
    }
  })
  // Öneri yüzdesi yüksekten düşüğe; dondurulmamış (bekleyen) maçlar sonda, saat sırasıyla.
  rows.sort((a, b) => b.percent - a.percent || (a.time ?? '').localeCompare(b.time ?? '') || a.matchId.localeCompare(b.matchId))

  return {
    date,
    categoryId,
    scope,
    tally: tally(scoped),
    rows: rows.map(({ percent: _percent, ...row }) => row),
    unsettled: rows.filter((r) => r.status === 'pending').length,
  }
}
