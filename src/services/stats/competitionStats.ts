import { COMPETITION_TYPES, type CompetitionType } from '../../config/competitionTypes'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import type { Match, Pick } from '../../types'
import { competitionTypeOf } from './competitionType'
import { categoryRates, mixStatsOf, type MixStats } from './mixStats'
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

export interface CompetitionRow extends MixStats {
  key: CompetitionKey | 'all'
  tally: Tally
  /** Önerisi olan benzersiz maç sayısı */
  matches: number
  /** Bu türe düşen benzersiz lig sayısı ("bilinmiyor"da 0) */
  leagues: number
  /** MAIN_CATEGORY_IDS sırasıyla */
  main: Tally[]
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

  const rates = categoryRates(picks)

  const rowOf = (key: CompetitionRow['key'], list: Pick[]): CompetitionRow => {
    const matchIds = [...new Set(list.map((p) => p.matchId))]
    return {
      key,
      tally: tally(list),
      matches: matchIds.length,
      leagues: new Set(matchIds.flatMap((id) => matchById.get(id)?.league ?? [])).size,
      main: MAIN_CATEGORY_IDS.map((id) => tally(list.filter((p) => p.categoryId === id))),
      ...mixStatsOf(list, rates),
    }
  }
  return [...ORDER.filter((key) => groups.has(key)).map((key) => rowOf(key, groups.get(key)!)), rowOf('all', picks)]
}
