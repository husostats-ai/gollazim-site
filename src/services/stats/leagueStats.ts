import type { Match, Pick } from '../../types'
import { competitionOf } from './competitionType'
import { categoryRates, mixStatsOf, type MixStats } from './mixStats'
import { tally, type Tally } from './statsEngine'
import { wilsonInterval } from './wilson'

// Lig bazlı başarı (yalnızca "Analiz için özet"te kullanılır; okur, hiçbir kaydı değiştirmez).
// Lig öneride saklanmaz: önerinin maç kaydından okunur. Anahtar "ülke · lig adı"dır; aynı adlı
// lig başka ülkede ayrı satırdır. Az önerili ligler tek "diğer" satırında toplanır, maç kaydı
// silinmiş öneriler "bilinmiyor"dadır; böylece satırların toplamı genel toplamla aynı kalır.

/** Kendi satırını alması için ligin en az bu kadar sonuçlanmış önerisi olmalı */
export const LEAGUE_MIN_DECIDED = 10
/** En çok bu kadar lig kendi satırını alır (sonuçlanmış öneriye göre azalan); kalanı "diğer"dedir */
export const LEAGUE_MAX_ROWS = 25
export const NO_LEAGUE_NAME = 'Lig adı yok'

export interface LeagueRow extends MixStats {
  kind: 'league' | 'other' | 'unknown' | 'all'
  /** Lig satırında "ülke · lig adı"; diğer satırlarda boş */
  name: string
  tally: Tally
  /** Başarının %95 Wilson aralığı; sonuçlanmış öneri yoksa null */
  interval: { low: number; high: number } | null
  /** Önerisi olan benzersiz maç sayısı */
  matches: number
  /** Satırdaki lig sayısı (lig satırında 1, "bilinmiyor"da 0) */
  leagues: number
}

export const leagueNameOf = (match: Match): string => {
  const { country, league } = competitionOf(match)
  return [country, league].filter(Boolean).join(' · ') || NO_LEAGUE_NAME
}

/** Lig bazlı başarı: ligler (sonuçlanmış öneriye göre azalan), "diğer", "bilinmiyor", sonda 'all'; öneri yoksa boş. */
export function buildLeagueStats(picks: Pick[], matches: Match[]): LeagueRow[] {
  if (picks.length === 0) return []
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const groups = new Map<string, Pick[]>()
  const unknown: Pick[] = []
  for (const pick of picks) {
    const match = matchById.get(pick.matchId)
    if (!match) unknown.push(pick)
    else {
      const name = leagueNameOf(match)
      const list = groups.get(name)
      if (list) list.push(pick)
      else groups.set(name, [pick])
    }
  }
  const rates = categoryRates(picks)
  const rowOf = (kind: LeagueRow['kind'], name: string, list: Pick[], leagues: number): LeagueRow => {
    const total = tally(list)
    return { kind, name, tally: total, interval: wilsonInterval(total.won, total.decided), matches: new Set(list.map((p) => p.matchId)).size, leagues, ...mixStatsOf(list, rates) }
  }
  const sorted = [...groups]
    .map(([name, list]) => rowOf('league', name, list, 1))
    .sort((a, b) => b.tally.decided - a.tally.decided || a.name.localeCompare(b.name, 'en'))
  const own = sorted.filter((r) => r.tally.decided >= LEAGUE_MIN_DECIDED).slice(0, LEAGUE_MAX_ROWS)
  const rest = sorted.filter((r) => !own.includes(r))
  return [
    ...own,
    ...(rest.length > 0 ? [rowOf('other', '', rest.flatMap((r) => groups.get(r.name)!), rest.length)] : []),
    ...(unknown.length > 0 ? [rowOf('unknown', '', unknown, 0)] : []),
    rowOf('all', '', picks, groups.size),
  ]
}
