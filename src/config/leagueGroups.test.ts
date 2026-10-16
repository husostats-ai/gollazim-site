import { describe, expect, it } from 'vitest'
import { formatBaseline, LEAGUE_BASELINES } from './leagueBaselines'
import { LEAGUE_GROUPS, leagueGroupOf, type LeagueGroupId } from './leagueGroups'

const EXPECTED: [string, LeagueGroupId][] = [
  ['England · Premier League', 'big5'],
  ['Spain · La Liga', 'big5'],
  ['Germany · Bundesliga', 'big5'],
  ['Italy · Serie A', 'big5'],
  ['France · Ligue 1', 'big5'],
  ['Europe · UEFA Champions League', 'euroCups'],
  ['Europe · UEFA Europa League', 'euroCups'],
  ['Europe · UEFA Europa Conference League', 'euroCups'],
  ['Europe · UEFA Conference League', 'euroCups'],
  ['Europe · UEFA Youth League', 'youth'],
  ['England · Professional Development League', 'youth'],
  ['Europe · UEFA U21 Championship Qualification', 'youth'],
  ['England · U18 Premier League', 'youth'],
  ['Iceland · U19 League', 'youth'],
  ['England · EFL Trophy', 'otherCups'],
  ['Asia · AFC Champions League', 'otherCups'],
  ['Japan · Emperor Cup', 'otherCups'],
  ['Asia · AFC Cup', 'otherCups'],
  ['Japan · J-League Cup', 'otherCups'],
  ['Asia · ASEAN Club Championship', 'otherCups'],
  ['International · UEFA Nations League', 'unsure'],
  ['International · ASEAN Cup', 'unsure'],
]

describe('sabit lig grupları', () => {
  it.each(EXPECTED)('%s → %s', (league, group) => {
    expect(leagueGroupOf(league)).toBe(group)
  })

  it('listede olmayan lig "Diğer yetişkin ligler"dedir', () => {
    for (const league of ['England · Championship', 'Netherlands · Eerste Divisie', 'Lig adı yok']) {
      expect(leagueGroupOf(league)).toBe('otherAdult')
    }
  })

  it('eşleşme tam "ülke · lig adı" ile: başka ülkedeki aynı adlı lig ya da yalnızca lig adı gruba girmez', () => {
    expect(leagueGroupOf('Wales · Premier League')).toBe('otherAdult')
    expect(leagueGroupOf('Premier League')).toBe('otherAdult')
    expect(leagueGroupOf('Brazil · Serie A')).toBe('otherAdult')
  })

  it('kulüp kupası ASEAN Club Championship "Diğer kupalar"da, milli takım kupası ASEAN Cup "Belirsiz"de', () => {
    expect(leagueGroupOf('Asia · ASEAN Club Championship')).toBe('otherCups')
    expect(leagueGroupOf('International · ASEAN Cup')).toBe('unsure')
  })

  it('Konferans Ligi\'nin iki adı da aynı gruptadır', () => {
    expect(leagueGroupOf('Europe · UEFA Europa Conference League')).toBe(leagueGroupOf('Europe · UEFA Conference League'))
  })

  it('bir lig birden fazla grupta yer almaz; listedeki ligler beklenenlerle aynıdır', () => {
    const all = LEAGUE_GROUPS.flatMap((g) => g.leagues)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(EXPECTED.map(([league]) => league).sort())
  })

  it('gruplar sabit sıradadır; "Diğer yetişkin ligler" sondadır ve listesi boştur', () => {
    expect(LEAGUE_GROUPS.map((g) => g.label)).toEqual(['Beş büyük lig', 'Avrupa kupaları', 'Gençlik / U-takım', 'Diğer kupalar', 'Belirsiz', 'Diğer yetişkin ligler'])
    expect(LEAGUE_GROUPS.at(-1)!.leagues).toEqual([])
  })

  it('tabanlar beş büyük lig ile Şampiyonlar / Avrupa Ligi içindir; Konferans Ligi\'nin tabanı yok', () => {
    expect(LEAGUE_BASELINES.map((b) => leagueGroupOf(b.league))).toEqual(['big5', 'big5', 'big5', 'big5', 'big5', 'euroCups', 'euroCups'])
    expect(LEAGUE_BASELINES.some((b) => b.league.includes('Conference'))).toBe(false)
  })

  it('taban her zaman bir ondalıkla yazılır', () => {
    expect([60, 61.0, 55.3].map(formatBaseline)).toEqual(['%60,0', '%61,0', '%55,3'])
  })
})
