import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { MatchResult } from '../../types'
import { makeMatch } from '../analysis/testUtils'
import { buildPicksForResult } from './freeze'

const NOW = '2026-10-05T21:00:00Z'
const result = (values: Partial<MatchResult>): MatchResult => ({
  matchId: 'x',
  status: 'completed',
  htHome: null,
  htAway: null,
  ftHome: null,
  ftAway: null,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: NOW,
  ...values,
})

describe('buildPicksForResult', () => {
  // 2.5 Üst %80 (eşik 75: önerilir), KG Var %60 (eşik 80: önerilmez), korner 8.5 %90 (önerilir)
  const match = makeMatch({ over25Pct: 80, bttsPct: 60, corners85Pct: 90 })
  const other = makeMatch({ over25Pct: 95 })
  const base = { match, dayMatches: [match, other], thresholds: defaultThresholds(), now: NOW }
  const win = result({ htHome: 1, htAway: 0, ftHome: 3, ftAway: 1 })

  it('sadece maçın o an önerildiği kategorileri, o anki yüzde ve eşikle dondurur', () => {
    const picks = buildPicksForResult({ ...base, result: win, existing: [] })
    expect(picks.map((p) => [p.categoryId, p.percent, p.threshold, p.outcome])).toEqual([
      ['over25', 80, 75, 'won'],
      ['corners85', 90, 70, 'void'], // korner girilmedi
    ])
    expect(picks.every((p) => p.date === match.date && p.frozenAt === NOW)).toBe(true)
    expect(picks.map((p) => p.reliability)).toEqual(['unknown', 'unmeasured'])
  })

  it('Taraf & Gol önerisinde çelişki bilgisi ve piyasa rozeti de dondurulur', () => {
    const side = makeMatch({ oddsHome: 1.4, oddsDraw: 5, oddsAway: 8, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 0.8, awayXg: 1.9 })
    const picks = buildPicksForResult({ ...base, match: side, dayMatches: [side], result: win, existing: [] })
    const home15 = picks.find((p) => p.categoryId === 'homeWin15')!
    expect(home15).toMatchObject({ conflict: true, reliability: 'market', outcome: 'won', threshold: 55 })
    // diğer kategorilerde çelişki alanı yoktur
    expect(buildPicksForResult({ ...base, result: win, existing: [] })[0].conflict).toBeUndefined()
  })

  it('tamamlanmamış maçta hiçbir şey dondurmaz', () => {
    for (const status of ['pending', 'postponed', 'cancelled'] as const) {
      expect(buildPicksForResult({ ...base, result: result({ status }), existing: [] })).toEqual([])
    }
  })

  it('eşik sonradan değişse de dondurulmuş öneri seti, yüzde ve eşik aynı kalır', () => {
    const frozen = buildPicksForResult({ ...base, result: win, existing: [] })
    // Eşik 90'a çıktı (maç artık önerilmezdi) ve KG Var eşiği 50'ye indi (artık önerilirdi)
    const thresholds = { ...defaultThresholds(), over25: 90, btts: 50 }
    const again = buildPicksForResult({ ...base, thresholds, result: win, existing: frozen })
    expect(again).toEqual(frozen)
  })

  it('skor düzeltilince sadece sonuç yeniden hesaplanır', () => {
    const frozen = buildPicksForResult({ ...base, result: win, existing: [] })
    const corrected = result({ htHome: 1, htAway: 0, ftHome: 1, ftAway: 1, cornersHome: 5, cornersAway: 4 })
    const picks = buildPicksForResult({ ...base, result: corrected, existing: frozen, now: '2026-10-06T08:00:00Z' })
    expect(picks.map((p) => [p.categoryId, p.percent, p.threshold, p.outcome, p.frozenAt])).toEqual([
      ['over25', 80, 75, 'lost', NOW],
      ['corners85', 90, 70, 'won', NOW],
    ])
  })

  it('tamamlanan maç sonradan ertelendi yapılırsa öneriler beklemeye döner', () => {
    const frozen = buildPicksForResult({ ...base, result: win, existing: [] })
    const picks = buildPicksForResult({ ...base, result: result({ status: 'postponed' }), existing: frozen })
    expect(picks.map((p) => p.outcome)).toEqual(['pending', 'pending'])
  })

  it('ilk 15 dışında kalan maç için öneri dondurulmaz', () => {
    const stronger = Array.from({ length: 15 }, () => makeMatch({ over25Pct: 99 }))
    const weak = makeMatch({ over25Pct: 80 })
    const picks = buildPicksForResult({ ...base, match: weak, dayMatches: [...stronger, weak], result: win, existing: [] })
    expect(picks).toEqual([])
  })
})
