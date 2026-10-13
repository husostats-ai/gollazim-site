import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Match, Pick, PickOutcome } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { buildLeagueStats, LEAGUE_MAX_ROWS, LEAGUE_MIN_DECIDED, leagueNameOf, NO_LEAGUE_NAME } from './leagueStats'
import { buildStats } from './statsEngine'
import { wilsonInterval } from './wilson'

let n = 0
/** Bir ligde, her biri ayrı maçta olan öneriler */
const league = (name: string | null, outcomes: PickOutcome[], categoryId: CategoryId = 'over25', percent = 80): { picks: Pick[]; matches: Match[] } => {
  const picks: Pick[] = []
  const matches: Match[] = []
  for (const outcome of outcomes) {
    const id = `m${++n}`
    if (name !== null) matches.push(makeMatch({}, { id, date: '2026-10-09', home: `Ev ${n}`, away: `Dep ${n}`, league: name }))
    picks.push({ id: `${id}|${categoryId}`, matchId: id, categoryId, date: '2026-10-09', percent, threshold: 75, outcome, frozenAt: '' })
  }
  return { picks, matches }
}
const of = (count: number, outcome: PickOutcome): PickOutcome[] => Array.from({ length: count }, () => outcome)
const join = (...parts: { picks: Pick[]; matches: Match[] }[]) => ({ picks: parts.flatMap((p) => p.picks), matches: parts.flatMap((p) => p.matches) })

const data = join(
  league('England · Premier League', [...of(15, 'won'), ...of(5, 'lost')]),
  league('Wales · Premier League', [...of(6, 'won'), ...of(4, 'lost'), 'void']),
  league('Germany · Bundesliga', [...of(12, 'lost'), ...of(7, 'won')], 'btts', 90),
  league('Turkey · Süper Lig', [...of(5, 'won'), ...of(4, 'lost')]),
  league('Japan · J1 League', ['void', 'pending']),
  league(null, ['lost', 'void']),
)
const rows = buildLeagueStats(data.picks, data.matches)
const named = (name: string) => rows.find((r) => r.name === name)!
const kind = (k: string) => rows.find((r) => r.kind === k)!

describe('lig bazlı başarı', () => {
  it('ligler sonuçlanmış öneriye göre azalan; sonra diğer, bilinmiyor, tümü', () => {
    expect(rows.map((r) => r.name || r.kind)).toEqual(['England · Premier League', 'Germany · Bundesliga', 'Wales · Premier League', 'other', 'unknown', 'all'])
  })

  it('anahtar ülke + lig adıdır: aynı adlı lig başka ülkede ayrı satırdır', () => {
    expect(named('England · Premier League').tally).toMatchObject({ won: 15, decided: 20 })
    expect(named('Wales · Premier League').tally).toMatchObject({ won: 6, decided: 10, void: 1 })
    expect(leagueNameOf(makeMatch({}, { league: 'FA Cup' }))).toBe('FA Cup')
    expect(leagueNameOf({ ...makeMatch({}, {}), league: undefined, stats: {} })).toBe(NO_LEAGUE_NAME)
  })

  it(`"diğer": ${LEAGUE_MIN_DECIDED}'dan az sonuçlanmış önerisi olan ligler (yalnızca değerlendirilemeyeni olan dahil)`, () => {
    expect(named('Turkey · Süper Lig')).toBeUndefined()
    expect(kind('other')).toMatchObject({ leagues: 2, matches: 11 })
    expect(kind('other').tally).toMatchObject({ won: 5, decided: 9, void: 1, pending: 1, total: 11 })
    // 9 sonuçlanmış öneri diğere, 10 kendi satırına
    expect(named('Wales · Premier League').tally.decided).toBe(LEAGUE_MIN_DECIDED)
  })

  it('satırların toplamı genel toplamla aynıdır', () => {
    const overall = buildStats(data.picks).overall
    const parts = rows.filter((r) => r.kind !== 'all')
    for (const field of ['won', 'lost', 'void', 'pending', 'decided', 'total'] as const) {
      expect(parts.reduce((sum, r) => sum + r.tally[field], 0), field).toBe(overall[field])
    }
    expect(kind('all').tally).toEqual(overall)
    expect(parts.reduce((sum, r) => sum + r.matches, 0)).toBe(kind('all').matches)
    expect(kind('all').leagues).toBe(5)
    expect(kind('unknown')).toMatchObject({ leagues: 0, matches: 2 })
  })

  it('"az veri": 20\'den az sonuçlanmış öneri', () => {
    expect(named('Germany · Bundesliga').tally).toMatchObject({ decided: 19, lowSample: true })
    expect(named('England · Premier League').tally).toMatchObject({ decided: 20, lowSample: false })
  })

  it('Wilson aralığı, hazır ortalama ve farklar', () => {
    const premier = named('England · Premier League')
    expect(premier.interval).toEqual(wilsonInterval(15, 20))
    expect(premier.interval).toEqual({ low: 53.1, high: 88.8 })
    expect(premier).toMatchObject({ ready: 80, gap: -5 })
    // 2.5 Üst genel: 26 / 40 = %65 → beklenen %65, düzeltilmiş fark +10
    expect(premier).toMatchObject({ expected: 65, adjustedGap: 10 })
    // KG Var yalnızca Bundesliga'da: beklenen = gerçekleşen
    expect(named('Germany · Bundesliga')).toMatchObject({ ready: 90, expected: 36.8, adjustedGap: 0 })
    expect(kind('all').adjustedGap).toBe(0)
    expect(buildLeagueStats(league('A · B', ['void']).picks, [])[0].interval).toBeNull()
  })

  it(`en çok ${LEAGUE_MAX_ROWS} lig kendi satırını alır; kalanı diğerdedir ve toplam değişmez`, () => {
    // 27 lig: i. ligin 10 + i sonuçlanmış önerisi var
    const many = join(...Array.from({ length: LEAGUE_MAX_ROWS + 2 }, (_, i) => league(`Ülke ${i} · Lig`, of(10 + i, 'won'))))
    const result = buildLeagueStats(many.picks, many.matches)
    const own = result.filter((r) => r.kind === 'league')
    expect(own).toHaveLength(LEAGUE_MAX_ROWS)
    expect(own[0].tally.decided).toBe(36)
    expect(own[own.length - 1].tally.decided).toBe(12)
    const other = result.find((r) => r.kind === 'other')!
    expect(other).toMatchObject({ leagues: 2 })
    expect(other.tally.decided).toBe(10 + 11)
    expect([...own, other].reduce((sum, r) => sum + r.tally.decided, 0)).toBe(buildStats(many.picks).overall.decided)
  })

  it('eşit sayıda ligler ada göre sıralanır; öneri yoksa satır yoktur', () => {
    const tie = join(league('B · Lig', of(10, 'won')), league('A · Lig', of(10, 'lost')))
    expect(buildLeagueStats(tie.picks, tie.matches).slice(0, 2).map((r) => r.name)).toEqual(['A · Lig', 'B · Lig'])
    expect(buildLeagueStats([], data.matches)).toEqual([])
  })
})
