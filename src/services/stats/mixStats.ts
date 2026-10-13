import type { Pick } from '../../types'
import { tally } from './statsEngine'

// Bir öneri grubunun (lig türü, lig) hazır yüzde ortalaması ve kategori karışımına göre
// beklenen başarısı. Ölçüm tablolarının ortak hesabıdır; yalnızca okur.

const isDecided = (p: Pick): boolean => p.outcome === 'won' || p.outcome === 'lost'
const round1 = (value: number): number => Math.round(value * 10) / 10
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

export interface MixStats {
  /** Sonuçlanmış önerilerin ortalama hazır yüzdesi */
  ready: number | null
  /** Gerçekleşen başarı − ortalama hazır yüzde (puan) */
  gap: number | null
  /** Kategori karışımına göre beklenen başarı: her sonuçlanmış öneriye kendi kategorisinin genel başarısı verilir */
  expected: number | null
  /** Gerçekleşen başarı − beklenen başarı (puan); yaklaşık */
  adjustedGap: number | null
}

/** Kategorinin genel başarısı (0–1), yuvarlanmadan; sonuçlanmış önerisi olmayan kategori haritaya girmez */
export function categoryRates(picks: Pick[]): Map<string, number> {
  const rates = new Map<string, number>()
  for (const id of new Set(picks.map((p) => p.categoryId))) {
    const t = tally(picks.filter((p) => p.categoryId === id))
    if (t.decided > 0) rates.set(id, t.won / t.decided)
  }
  return rates
}

/** list: grubun önerileri; rates: grubun içinde olduğu TÜM önerilerin kategori başarıları */
export function mixStatsOf(list: Pick[], rates: ReadonlyMap<string, number>): MixStats {
  const decided = list.filter(isDecided)
  if (decided.length === 0) return { ready: null, gap: null, expected: null, adjustedGap: null }
  const ready = mean(decided.map((p) => p.percent))
  const expected = mean(decided.map((p) => rates.get(p.categoryId)!)) * 100
  const actual = (decided.filter((p) => p.outcome === 'won').length / decided.length) * 100
  return { ready: round1(ready), gap: round1(actual - ready), expected: round1(expected), adjustedGap: round1(actual - expected) }
}
