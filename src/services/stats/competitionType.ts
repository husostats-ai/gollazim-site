import {
  AGE_GROUP,
  CLUB_COMPETITION,
  CUP_COMPETITION,
  INTERNATIONAL_COUNTRIES,
  NATIONAL_COMPETITION,
  NATIONAL_COUNTRY,
  NOT_RESERVE_TEAMS,
  RESERVE_TEAM,
  RESERVE_TEAMS,
  YOUTH_LEAGUE,
  type CompetitionType,
} from '../../config/competitionTypes'
import type { Match } from '../../types'

// Maçın lig türünü maç kaydından türetir (kurallar: config/competitionTypes). Yalnızca okur.

type MatchLike = Pick<Match, 'league' | 'home' | 'away'> & { stats?: Match['stats'] }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Ülke ve lig adı: CSV kolonlarından; yoksa "Ülke · Lig" biçimindeki lig alanından */
export function competitionOf(match: MatchLike): { country: string; league: string } {
  const parts = text(match.league).split(' · ')
  return {
    country: text(match.stats?.country) || (parts.length > 1 ? parts[0] : ''),
    league: text(match.stats?.league) || parts.slice(parts.length > 1 ? 1 : 0).join(' · '),
  }
}

export function isReserveTeam(name: string): boolean {
  const team = name.trim()
  const lower = team.toLocaleLowerCase('en')
  if (NOT_RESERVE_TEAMS.includes(lower)) return false
  return RESERVE_TEAMS.includes(lower) || RESERVE_TEAM.test(team)
}

/** Öncelik: gençlik > rezerv > milli takım > kupa > lig */
export function competitionTypeOf(match: MatchLike): CompetitionType {
  const { country, league } = competitionOf(match)
  const teams = [match.home, match.away]
  if (AGE_GROUP.test(league) || YOUTH_LEAGUE.test(league) || teams.some((team) => AGE_GROUP.test(team))) return 'youth'
  if (teams.some(isReserveTeam)) return 'reserve'
  const land = country.toLocaleLowerCase('en')
  if ((land === NATIONAL_COUNTRY || NATIONAL_COMPETITION.test(league)) && !CLUB_COMPETITION.test(league)) return 'national'
  if (INTERNATIONAL_COUNTRIES.includes(land) || CUP_COMPETITION.test(league)) return 'cup'
  return 'league'
}
