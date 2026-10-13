import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Match, Pick, PickOutcome } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { buildCompetitionStats } from './competitionStats'
import { buildStats } from './statsEngine'

let n = 0
const data: { picks: Pick[]; matches: Match[] } = { picks: [], matches: [] }
/** Bir maç ve o maçın önerileri */
const add = (league: string, home: string, away: string, list: [CategoryId, PickOutcome, number][], keepMatch = true) => {
  const id = `m${++n}`
  if (keepMatch) data.matches.push(makeMatch({}, { id, date: '2026-10-09', home, away, league }))
  for (const [categoryId, outcome, percent] of list) data.picks.push({ id: `${id}|${categoryId}`, matchId: id, categoryId, date: '2026-10-09', percent, threshold: 75, outcome, frozenAt: '' })
}
add('England · Premier League', 'Arsenal', 'Leeds United', [['over25', 'won', 80], ['btts', 'lost', 90], ['corners85', 'void', 100]])
add('England · Championship', 'Watford', 'Burnley', [['over25', 'lost', 80], ['ht05', 'won', 100]])
add('England · EFL Trophy', 'Stevenage', 'Leicester City', [['over25', 'won', 100], ['ht05', 'pending', 100]])
add('England · EFL Trophy', 'Doncaster Rovers', 'Liverpool U21', [['over25', 'won', 100]])
add('Germany · 3. Liga', 'Meppen', 'Stuttgart II', [['btts', 'lost', 80]])
add('International · UEFA Nations League', 'France', 'Belgium', [['btts', 'won', 70]])
add('Silinmiş · Lig', 'X', 'Y', [['over25', 'lost', 90]], false)

const rows = buildCompetitionStats(data.picks, data.matches)
const row = (key: string) => rows.find((r) => r.key === key)!

describe('lig türüne göre başarı', () => {
  it('satırlar öncelik sırasıyla; maç kaydı silinmiş öneri "bilinmiyor"; sonda "all"', () => {
    expect(rows.map((r) => r.key)).toEqual(['youth', 'reserve', 'national', 'cup', 'league', 'unknown', 'all'])
  })

  it('türlerin toplamı genel toplamla aynıdır', () => {
    const overall = buildStats(data.picks).overall
    const typed = rows.filter((r) => r.key !== 'all')
    for (const field of ['won', 'lost', 'void', 'pending', 'decided', 'total'] as const) {
      expect(typed.reduce((sum, r) => sum + r.tally[field], 0), field).toBe(overall[field])
    }
    expect(row('all').tally).toEqual(overall)
    expect(typed.reduce((sum, r) => sum + r.matches, 0)).toBe(row('all').matches)
  })

  it('tür başına sayım, maç ve lig sayısı, ana kategoriler', () => {
    const league = row('league')
    expect(league.tally).toMatchObject({ won: 2, lost: 2, void: 1, decided: 4, rate: 50, lowSample: true })
    expect(league.matches).toBe(2)
    expect(league.leagues).toBe(2)
    // 2.5 Üst, KG Var, İY 0.5 Üst
    expect(league.main.map((t) => `${t.won}/${t.decided}`)).toEqual(['1/2', '0/1', '1/1'])
    expect(row('cup').tally).toMatchObject({ won: 1, decided: 1, pending: 1 })
    expect(row('unknown').leagues).toBe(0)
  })

  it('hazır ortalama ve fark yalnızca sonuçlanmış öneriler üzerindendir', () => {
    // lig: 80, 90, 80, 100 (değerlendirilemeyen 100 girmez) → 87,5; başarı %50
    expect(row('league').ready).toBe(87.5)
    expect(row('league').gap).toBe(-37.5)
    // kupa: bekleyen öneri girmez
    expect(row('cup').ready).toBe(100)
    expect(row('cup').gap).toBe(0)
  })

  it('düzeltilmiş fark: her öneriye kendi kategorisinin genel başarısı verilir', () => {
    // Genel: 2.5 Üst 3/5 = %60, KG Var 1/3 = %33,3, İY 0.5 Üst 1/1 = %100
    // lig: (60 + 33,3 + 60 + 100) / 4 = %63,3 beklenen; gerçekleşen %50
    expect(row('league').expected).toBe(63.3)
    expect(row('league').adjustedGap).toBe(-13.3)
    // gençlik: tek 2.5 Üst önerisi, tuttu → beklenen %60, fark +40
    expect(row('youth').expected).toBe(60)
    expect(row('youth').adjustedGap).toBe(40)
    // tüm türler birlikte: beklenen = gerçekleşen
    expect(row('all').adjustedGap).toBe(0)
  })

  it('sonuçlanmış önerisi olmayan türde ortalama ve farklar boştur; öneri yoksa satır yoktur', () => {
    const pendingOnly = buildCompetitionStats(data.picks.filter((p) => p.outcome === 'pending'), data.matches)
    expect(pendingOnly[0]).toMatchObject({ key: 'cup', ready: null, gap: null, expected: null, adjustedGap: null })
    expect(buildCompetitionStats([], data.matches)).toEqual([])
  })
})
