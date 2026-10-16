import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Match, Pick, PickOutcome } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { recordShare, removeShare, sharedPicksOnly } from '../story/shared'
import { buildLeagueCategoryStats, LEAGUE_CATEGORY_MIN_N } from './leagueCategoryStats'
import { leagueNameOf } from './leagueStats'
import { buildStats } from './statsEngine'
import { wilsonInterval } from './wilson'

let n = 0
type Data = { picks: Pick[]; matches: Match[] }
/** Bir ligde, her biri ayrı maçta olan öneriler */
const league = (name: string | null, outcomes: PickOutcome[], categoryId: CategoryId = 'over25'): Data => {
  const picks: Pick[] = []
  const matches: Match[] = []
  for (const outcome of outcomes) {
    const id = `lc${++n}`
    if (name !== null) matches.push(makeMatch({}, { id, date: '2026-10-09', league: name }))
    picks.push({ id: `${id}|${categoryId}`, matchId: id, categoryId, date: '2026-10-09', percent: 80, threshold: 75, outcome, frozenAt: '' })
  }
  return { picks, matches }
}
const of = (count: number, outcome: PickOutcome): PickOutcome[] => Array.from({ length: count }, () => outcome)
const join = (...parts: Data[]): Data => ({ picks: parts.flatMap((p) => p.picks), matches: parts.flatMap((p) => p.matches) })
/** Aynı maçlarda başka kategori önerileri */
const sameMatches = (base: Data, categoryId: CategoryId, outcome: PickOutcome): Data => ({
  picks: base.picks.map((p) => ({ ...p, id: `${p.matchId}|${categoryId}`, categoryId, outcome })),
  matches: [],
})

const premier = league('England · Premier League', [...of(14, 'won'), ...of(6, 'lost')]) // 20 → yüzde var
const data = join(
  premier,
  sameMatches(premier, 'btts', 'won'), // aynı 20 maçta KG VAR: 20/20
  sameMatches(premier, 'ht05', 'lost'),
  league('Wales · Premier League', [...of(12, 'won'), ...of(7, 'lost'), 'void', 'pending']), // 19 sonuçlanmış
  league('Germany · Bundesliga', [...of(10, 'won'), ...of(9, 'lost')], 'btts'), // 19: tabanı var ama az veri
  league('Turkey · Süper Lig', of(3, 'won'), 'ht05'),
  league('Japan · J1 League', ['void', 'pending']), // sonuçlanmış öneri yok
  league('Spain · La Liga', of(5, 'won'), 'sh05'), // ana kategori değil
  league(null, ['lost', 'won']), // maç kaydı yok
)
const stats = buildLeagueCategoryStats(data.picks, data.matches)
const named = (name: string) => stats.leagues.find((l) => l.name === name)

describe('lig bazlı ana kategoriler: ligler', () => {
  it('lig adı leagueNameOf ile aynı; aynı adlı lig başka ülkede ayrı satırdır', () => {
    for (const l of stats.leagues) expect(data.matches.some((m) => leagueNameOf(m) === l.name)).toBe(true)
    expect(named('England · Premier League')!.decided).toBe(60)
    expect(named('Wales · Premier League')!.decided).toBe(19)
  })

  it('sonuçlanmış öneriye göre azalan, eşitlikte ada göre; yalnızca değerlendirilemeyeni olan lig yok', () => {
    expect(stats.leagues.map((l) => l.name)).toEqual(['England · Premier League', 'Germany · Bundesliga', 'Wales · Premier League', 'Turkey · Süper Lig'])
    expect(named('Japan · J1 League')).toBeUndefined()
  })

  it('lig sınırı ve "diğer" toplaması yok: 30 küçük lig de kendi satırını alır', () => {
    const many = join(...Array.from({ length: 30 }, (_, i) => league(`Ülke ${i} · Lig`, ['won'])))
    const s = buildLeagueCategoryStats(many.picks, many.matches)
    expect(s.leagues).toHaveLength(30)
    expect(s.leagues.every((l) => l.decided === 1)).toBe(true)
  })

  it('ana kategoriler dışındaki öneriler sayılmaz', () => {
    expect(named('Spain · La Liga')).toBeUndefined()
    expect(stats.total.decided).toBe(60 + 19 + 19 + 3 + 2)
  })

  it(`n < ${LEAGUE_CATEGORY_MIN_N}: yüzde, aralık ve fark null; n = ${LEAGUE_CATEGORY_MIN_N}: dolu ve Wilson aynı`, () => {
    const wales = named('Wales · Premier League')!.cells.over25
    expect(wales).toMatchObject({ decided: 19, won: 12, rate: null, interval: null, lowSample: true, baselineGap: null })
    const eng = named('England · Premier League')!.cells.over25
    expect(eng).toMatchObject({ decided: 20, won: 14, rate: 70, lowSample: false })
    expect(eng.interval).toEqual(wilsonInterval(14, 20))
  })

  it('benzersiz maç: aynı maçın üç kategori önerisi satırda 1 maç, her hücrede 1 maç', () => {
    const eng = named('England · Premier League')!
    expect(eng.matches).toBe(20)
    expect([eng.cells.over25.matches, eng.cells.btts.matches, eng.cells.ht05.matches]).toEqual([20, 20, 20])
    expect(stats.total.matches).toBe(20 + 19 + 19 + 3 + 2)
  })

  it('taban farkı: yalnızca KG VAR ve 2.5 ÜST, tabanı olan lig ve n ≥ 20; işaret bizim − taban; İY 0.5\'te yok', () => {
    const eng = named('England · Premier League')!
    expect(eng.baseline).toEqual({ btts: 55.3, over25: 56.6 })
    expect(eng.cells.over25.baselineGap).toBe(13.4) // 70 − 56,6
    expect(eng.cells.btts.baselineGap).toBe(44.7) // 100 − 55,3
    expect(eng.cells.ht05).toMatchObject({ decided: 20, rate: 0, baselineGap: null })
    expect(named('Germany · Bundesliga')!.cells.btts.baselineGap).toBeNull() // n = 19
    expect(named('Wales · Premier League')!.baseline).toBeNull()
    expect(stats.cellCounts).toEqual({ cells: 12, withData: 6, comparable: 3, baselineGaps: 2 })
  })
})

describe('lig bazlı ana kategoriler: gruplar', () => {
  it('gruplar sabit sırada, önerisi olmayan grup da satırdır; grup içi lig listesi', () => {
    expect(stats.groups.map((g) => g.id)).toEqual(['big5', 'euroCups', 'youth', 'otherCups', 'unsure', 'otherAdult'])
    const big5 = stats.groups[0]
    expect(big5.leagues).toEqual([
      { name: 'England · Premier League', decided: 60 },
      { name: 'Germany · Bundesliga', decided: 19 },
    ])
    expect(big5.cells.btts).toMatchObject({ decided: 39, won: 30 })
    expect(stats.groups[1]).toMatchObject({ decided: 0, matches: 0, leagues: [] })
    expect(stats.groups[5].leagues.map((l) => l.name)).toEqual(['Wales · Premier League', 'Turkey · Süper Lig'])
  })

  it('grup toplamları + "Bilinmiyor" = genel toplam; maç kaydı olmayan öneri hiçbir gruba girmez', () => {
    expect(stats.unknown).toMatchObject({ decided: 2, matches: 2 })
    const sum = stats.groups.reduce((s, g) => s + g.decided, 0) + stats.unknown!.decided
    expect(sum).toBe(stats.total.decided)
    for (const id of ['over25', 'btts', 'ht05'] as const) {
      const won = stats.groups.reduce((s, g) => s + g.cells[id].won, 0) + stats.unknown!.cells[id].won
      expect(won).toBe(stats.total.cells[id].won)
    }
    expect(buildLeagueCategoryStats(premier.picks, premier.matches).unknown).toBeNull()
  })

  it('kapsam: paylaşılan öneriler verildiğinde n, sharedPicksOnly + buildStats ile aynı; çıkarılmış paylaşım sayılmaz', () => {
    const shareOf = (picks: Pick[], categoryId: CategoryId) =>
      recordShare([], { date: '2026-10-09', categoryId, matches: picks.map((p) => ({ id: p.matchId, date: p.date, time: '20:00' })), now: '2026-10-09T09:00:00.000Z' })
    let shared = [...shareOf(premier.picks.slice(0, 5), 'over25'), ...shareOf(premier.picks.slice(0, 2), 'btts')]
    shared = removeShare(shared, '2026-10-09', 'over25', premier.picks[0].matchId, '2026-10-09T10:00:00.000Z')
    const scoped = sharedPicksOnly(data.picks, shared)
    const s = buildLeagueCategoryStats(scoped, data.matches)
    const engine = buildStats(scoped).byCategory
    expect(s.total.cells.over25.decided).toBe(4)
    expect(s.total.cells.btts.decided).toBe(2)
    expect(s.total.cells.over25.decided).toBe(engine.find((b) => b.key === 'over25')!.tally.decided)
    expect(s.total.cells.btts.decided).toBe(engine.find((b) => b.key === 'btts')!.tally.decided)
    // over25'ten çıkarılan maç KG VAR'da hâlâ paylaşılan: 2.5 ÜST'te 4 maç (1–4), KG VAR'da 2 maç (0–1) → 5 benzersiz maç
    expect(s.total.matches).toBe(5)
  })
})
