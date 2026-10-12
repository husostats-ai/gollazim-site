import { CATEGORIES, type CategoryId } from '../../config/categories'
import type { Match, Pick } from '../../types'
import { analyzeCategory } from '../analysis/engine'
import { tally, type Tally } from './statsEngine'

// Kategori içi sıraya göre başarı. Sıra öneri kaydında SAKLANMAZ: dondurma anındaki hesabın
// aynısı (o günün tüm maç kayıtları + önerinin kayıtlı eşiği) yeniden çalıştırılarak bulunur ve
// kayıtlı yüzdeyle karşılaştırılarak doğrulanır. Yalnızca okur; hiçbir kaydı değiştirmez.

/** Sıra bantları (ikisi de dahil). Yalnızca eşiği geçen ilk 15 dondurulduğu için 16 ve sonrası yoktur. */
export const RANK_BANDS = [
  { from: 1, to: 5, label: '1–5' },
  { from: 6, to: 10, label: '6–10' },
  { from: 11, to: 15, label: '11–15' },
] as const

/** Bir günün, bir kategorinin, bir eşikle sıralı listesi (en çok 15 maç) */
export type RankList = { id: string; percent: number }[]

/** Aynı gün ve kategoride farklı eşikle dondurulmuş öneriler olabilir: her eşiğin kendi listesi vardır. */
export const rankListKey = (pick: Pick_<Pick, 'categoryId' | 'threshold'>): string => `${pick.categoryId}|${pick.threshold}`

/** Dondurma anındaki hesabın aynısı: günün tüm maçları, kayıtlı eşik, yüzdeye göre sıra. */
export const rankList = (dayMatches: Match[], categoryId: CategoryId, threshold: number): RankList =>
  analyzeCategory(dayMatches, categoryId, threshold, 'percent').predictions.map((p) => ({ id: p.match.id, percent: p.percent }))

/**
 * Önerinin listedeki sırası (1'den başlar). Doğrulanamıyorsa null: öneri listede çıkmıyorsa
 * (maç kaydı yok ya da artık ilk 15'te değil) ya da yeniden hesaplanan yüzde kayıtlı yüzdeden
 * farklıysa (maç sonradan düzenlenmiş ya da CSV güncellenmiş).
 */
export function rankIn(list: RankList, pick: Pick_<Pick, 'matchId' | 'percent'>): number | null {
  const index = list.findIndex((item) => item.id === pick.matchId)
  return index >= 0 && list[index].percent === pick.percent ? index + 1 : null
}

export const matchesByDate = (dayMatches: Match[]): Map<string, Match[]> => {
  const byDate = new Map<string, Match[]>()
  for (const match of dayMatches) {
    const list = byDate.get(match.date)
    if (list) list.push(match)
    else byDate.set(match.date, [match])
  }
  return byDate
}

/**
 * Her önerinin kategori içi sırası; doğrulanamıyorsa null (bkz. rankIn).
 * dayMatches: önerisi olan günlerin TÜM maç kayıtları (önerisi olmayanlar sırayı doldurur).
 * Eşzamanlıdır; çok günlü veride sayfayı bekletmemek için rankJob kullanılır.
 */
export function pickRanks(picks: Pick[], dayMatches: Match[]): Map<string, number | null> {
  const byDate = matchesByDate(dayMatches)
  const lists = new Map<string, RankList>()
  const ranks = new Map<string, number | null>()
  for (const pick of picks) {
    const key = `${pick.date}|${rankListKey(pick)}`
    let list = lists.get(key)
    if (!list) {
      list = rankList(byDate.get(pick.date) ?? [], pick.categoryId, pick.threshold)
      lists.set(key, list)
    }
    ranks.set(pick.id, rankIn(list, pick))
  }
  return ranks
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

export interface RankRow {
  key: CategoryId | 'all'
  /** RANK_BANDS sırasıyla */
  bands: Tally[]
}

export interface RankStats {
  /** Kayıt defterindeki sırayla, sırası doğrulanan önerisi olan kategoriler; sonda 'all' */
  rows: RankRow[]
  /** Sırası doğrulanan öneri sayısı */
  verified: number
  /** Sırası doğrulanamayan öneri sayısı; hiçbir banda girmez */
  unverified: number
  /** "Tüm kategoriler" satırındaki sonuçlanmış önerilerin benzersiz maç sayısı */
  decidedMatches: number
}

/** Yeniden hesaplanmış ve doğrulanmış sıraya göre başarı; sırası doğrulanan öneri yoksa rows boştur. */
export const buildRankStats = (picks: Pick[], dayMatches: Match[]): RankStats => rankStatsOf(picks, pickRanks(picks, dayMatches))

/** Hazır sıralardan (pickRanks ya da rankJob çıktısı) tablo; sırası verilmemiş öneri doğrulanamayan sayılır. */
export function rankStatsOf(picks: Pick[], ranks: ReadonlyMap<string, number | null>): RankStats {
  const ranked = picks.flatMap((pick) => {
    const rank = ranks.get(pick.id) ?? null
    return rank === null ? [] : [{ pick, rank }]
  })
  const bandsOf = (categoryId?: CategoryId): Tally[] =>
    RANK_BANDS.map((band) => tally(ranked.filter((x) => x.rank >= band.from && x.rank <= band.to && (categoryId === undefined || x.pick.categoryId === categoryId)).map((x) => x.pick)))
  const rows: RankRow[] = CATEGORIES.map((c) => c.id)
    .filter((id) => ranked.some((x) => x.pick.categoryId === id))
    .map((id) => ({ key: id, bands: bandsOf(id) }))
  return {
    rows: rows.length === 0 ? [] : [...rows, { key: 'all', bands: bandsOf() }],
    verified: ranked.length,
    unverified: picks.length - ranked.length,
    decidedMatches: new Set(ranked.filter((x) => x.pick.outcome === 'won' || x.pick.outcome === 'lost').map((x) => x.pick.matchId)).size,
  }
}
