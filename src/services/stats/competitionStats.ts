import { COMPETITION_TYPES, type CompetitionType } from '../../config/competitionTypes'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import type { Match, Pick } from '../../types'
import { competitionTypeOf } from './competitionType'
import { tally, type Tally } from './statsEngine'

// Lig türüne göre başarı (yalnızca "Analiz için özet"te kullanılır; okur, hiçbir kaydı
// değiştirmez). Tür öneride saklanmaz: önerinin maç kaydından okuma anında türetilir. Maç kaydı
// silinmiş önerinin türü "bilinmiyor"dur; böylece satırların toplamı genel toplamla aynı kalır.

export type CompetitionKey = CompetitionType | 'unknown'
export const COMPETITION_LABELS: Record<CompetitionKey, string> = {
  ...(Object.fromEntries(COMPETITION_TYPES.map((t) => [t.id, t.label])) as Record<CompetitionType, string>),
  unknown: 'Bilinmiyor (maç kaydı yok)',
}
const ORDER: readonly CompetitionKey[] = [...COMPETITION_TYPES.map((t) => t.id), 'unknown']

const isDecided = (p: Pick): boolean => p.outcome === 'won' || p.outcome === 'lost'
const round1 = (value: number): number => Math.round(value * 10) / 10
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

export interface CompetitionRow {
  key: CompetitionKey | 'all'
  tally: Tally
  /** Önerisi olan benzersiz maç sayısı */
  matches: number
  /** Bu türe düşen benzersiz lig sayısı ("bilinmiyor"da 0) */
  leagues: number
  /** MAIN_CATEGORY_IDS sırasıyla */
  main: Tally[]
  /** Sonuçlanmış önerilerin ortalama hazır yüzdesi */
  ready: number | null
  /** Gerçekleşen başarı − ortalama hazır yüzde (puan) */
  gap: number | null
  /** Kategori karışımına göre beklenen başarı: her sonuçlanmış öneriye kendi kategorisinin genel başarısı verilir */
  expected: number | null
  /** Gerçekleşen başarı − beklenen başarı (puan); yaklaşık */
  adjustedGap: number | null
}

/** Lig türüne göre başarı: önerisi olan türler (öncelik sırasıyla), sonda 'all'; öneri yoksa boş. */
export function buildCompetitionStats(picks: Pick[], matches: Match[]): CompetitionRow[] {
  if (picks.length === 0) return []
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const typeByMatch = new Map<string, CompetitionKey>()
  const typeOf = (pick: Pick): CompetitionKey => {
    let type = typeByMatch.get(pick.matchId)
    if (!type) {
      const match = matchById.get(pick.matchId)
      type = match ? competitionTypeOf(match) : 'unknown'
      typeByMatch.set(pick.matchId, type)
    }
    return type
  }
  const groups = new Map<CompetitionKey, Pick[]>()
  for (const pick of picks) groups.set(typeOf(pick), [...(groups.get(typeOf(pick)) ?? []), pick])

  // Kategorinin genel başarısı (0–1), yuvarlanmadan; sonuçlanmış önerisi olmayan kategori haritaya girmez
  const categoryRate = new Map<string, number>()
  for (const id of new Set(picks.map((p) => p.categoryId))) {
    const t = tally(picks.filter((p) => p.categoryId === id))
    if (t.decided > 0) categoryRate.set(id, t.won / t.decided)
  }

  const rowOf = (key: CompetitionRow['key'], list: Pick[]): CompetitionRow => {
    const total = tally(list)
    const decided = list.filter(isDecided)
    const matchIds = [...new Set(list.map((p) => p.matchId))]
    const ready = decided.length === 0 ? null : mean(decided.map((p) => p.percent))
    const expected = decided.length === 0 ? null : mean(decided.map((p) => categoryRate.get(p.categoryId)!)) * 100
    const actual = decided.length === 0 ? null : (total.won / total.decided) * 100
    return {
      key,
      tally: total,
      matches: matchIds.length,
      leagues: new Set(matchIds.flatMap((id) => matchById.get(id)?.league ?? [])).size,
      main: MAIN_CATEGORY_IDS.map((id) => tally(list.filter((p) => p.categoryId === id))),
      ready: ready === null ? null : round1(ready),
      gap: actual === null || ready === null ? null : round1(actual - ready),
      expected: expected === null ? null : round1(expected),
      adjustedGap: actual === null || expected === null ? null : round1(actual - expected),
    }
  }
  return [...ORDER.filter((key) => groups.has(key)).map((key) => rowOf(key, groups.get(key)!)), rowOf('all', picks)]
}
