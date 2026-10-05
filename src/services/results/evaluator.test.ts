import { describe, expect, it } from 'vitest'
import { CATEGORIES, type CategoryId } from '../../config/categories'
import type { MatchResult, MatchStatus } from '../../types'
import { evaluatePick, secondHalfGoals } from './evaluator'

/** "İY 1-0, MS 3-1" gibi bir skordan sonuç kaydı üretir */
const result = (
  ht: [number, number] | null,
  ft: [number, number] | null,
  extra: Partial<MatchResult> = {},
): MatchResult => ({
  matchId: 'm1',
  status: 'completed',
  htHome: ht?.[0] ?? null,
  htAway: ht?.[1] ?? null,
  ftHome: ft?.[0] ?? null,
  ftAway: ft?.[1] ?? null,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: '2026-10-05T20:00:00Z',
  ...extra,
})

const corners = (home: number, away: number) => result([0, 0], [0, 0], { cornersHome: home, cornersAway: away })
const cards = (home: number, away: number) => result([0, 0], [0, 0], { cardsHome: home, cardsAway: away })

describe('2.5 Üst', () => {
  it.each([
    [[3, 1], 'won'],
    [[1, 1], 'lost'],
    [[2, 1], 'won'], // tam 3 gol
    [[3, 0], 'won'], // tam 3 gol, tek takım
    [[2, 0], 'lost'], // 2 gol
    [[0, 0], 'lost'],
  ] as const)('MS %j -> %s', (ft, expected) => {
    expect(evaluatePick('over25', result([0, 0], [...ft]))).toBe(expected)
  })
})

describe('3.5 Üst ve 4.5 Üst', () => {
  it.each([
    [[2, 1], 'lost', 'lost'], // 3 gol
    [[2, 2], 'won', 'lost'], // tam 4 gol
    [[4, 0], 'won', 'lost'],
    [[3, 2], 'won', 'won'], // tam 5 gol
    [[5, 0], 'won', 'won'],
    [[4, 3], 'won', 'won'],
  ] as const)('MS %j -> 3.5: %s, 4.5: %s', (ft, over35, over45) => {
    expect(evaluatePick('over35', result([0, 0], [...ft]))).toBe(over35)
    expect(evaluatePick('over45', result([0, 0], [...ft]))).toBe(over45)
  })
})

describe('KG Var', () => {
  it.each([
    [[3, 1], 'won'],
    [[1, 1], 'won'],
    [[2, 0], 'lost'],
    [[1, 0], 'lost'],
    [[0, 1], 'lost'],
    [[0, 0], 'lost'],
  ] as const)('MS %j -> %s', (ft, expected) => {
    expect(evaluatePick('btts', result([0, 0], [...ft]))).toBe(expected)
  })
})

describe('2.5 Üst & KG Var', () => {
  it.each([
    [[3, 1], 'won'],
    [[2, 1], 'won'], // tam 3 gol, iki takım da attı
    [[2, 0], 'lost'],
    [[1, 1], 'lost'], // KG var ama 2 gol
    [[3, 0], 'lost'], // 2.5 üst ama KG yok
    [[0, 4], 'lost'],
  ] as const)('MS %j -> %s', (ft, expected) => {
    expect(evaluatePick('over25btts', result([0, 0], [...ft]))).toBe(expected)
  })
})

describe('İlk Yarı 0.5 Üst ve 1.5 Üst', () => {
  it.each([
    [[1, 0], 'won', 'lost'], // tam 1 gol
    [[0, 0], 'lost', 'lost'],
    [[0, 1], 'won', 'lost'],
    [[1, 1], 'won', 'won'], // tam 2 gol
    [[2, 0], 'won', 'won'],
  ] as const)('İY %j -> 0.5: %s, 1.5: %s', (ht, ht05, ht15) => {
    const r = result([...ht], [3, 3])
    expect(evaluatePick('ht05', r)).toBe(ht05)
    expect(evaluatePick('ht15', r)).toBe(ht15)
  })

  it('ikinci yarıda atılan goller ilk yarı önerisini kazandırmaz', () => {
    expect(evaluatePick('ht05', result([0, 0], [4, 2]))).toBe('lost')
  })

  it('ilk yarı skoru girilmemişse değerlendirilemez', () => {
    expect(evaluatePick('ht05', result(null, [2, 1]))).toBe('void')
    expect(evaluatePick('ht15', result(null, [2, 1]))).toBe('void')
  })
})

describe('2. Yarı 0.5 Üst', () => {
  it('ikinci yarı golü = maç skoru - ilk yarı skoru', () => {
    expect(secondHalfGoals(result([1, 0], [3, 1]))).toBe(3)
    expect(secondHalfGoals(result([2, 1], [2, 1]))).toBe(0)
    expect(secondHalfGoals(result(null, [2, 1]))).toBeNull()
  })

  it.each([
    [[1, 0], [3, 1], 'won'],
    [[0, 0], [1, 0], 'won'], // ikinci yarıda tam 1 gol
    [[0, 0], [0, 1], 'won'],
    [[2, 1], [2, 1], 'lost'], // tüm goller ilk yarıda
    [[0, 0], [0, 0], 'lost'],
    [[3, 2], [3, 3], 'won'],
  ] as const)('İY %j, MS %j -> %s', (ht, ft, expected) => {
    expect(evaluatePick('sh05', result([...ht], [...ft]))).toBe(expected)
  })

  it('ilk yarı skoru girilmemişse değerlendirilemez', () => {
    expect(evaluatePick('sh05', result(null, [2, 1]))).toBe('void')
  })
})

describe('Korner', () => {
  it.each([
    [[5, 3], 'lost', 'lost', 'lost'], // 8
    [[5, 4], 'won', 'lost', 'lost'], // tam 9
    [[6, 4], 'won', 'won', 'lost'], // tam 10
    [[6, 5], 'won', 'won', 'won'], // tam 11
    [[0, 12], 'won', 'won', 'won'],
  ] as const)('korner %j -> 8.5: %s, 9.5: %s, 10.5: %s', (c, c85, c95, c105) => {
    const r = corners(c[0], c[1])
    expect(evaluatePick('corners85', r)).toBe(c85)
    expect(evaluatePick('corners95', r)).toBe(c95)
    expect(evaluatePick('corners105', r)).toBe(c105)
  })

  it('korner girilmemişse kaybetti değil, değerlendirilemedi olur', () => {
    const r = result([1, 0], [3, 1])
    for (const id of ['corners85', 'corners95', 'corners105'] as const) expect(evaluatePick(id, r)).toBe('void')
  })
})

describe('Kart', () => {
  it.each([
    [[2, 1], 'lost', 'lost'], // 3
    [[2, 2], 'won', 'lost'], // tam 4
    [[4, 0], 'won', 'lost'],
    [[2, 3], 'won', 'won'], // tam 5
    [[0, 0], 'lost', 'lost'], // 0 kart girilmiş bir değerdir, "veri yok" değil
  ] as const)('kart %j -> 3.5: %s, 4.5: %s', (c, c35, c45) => {
    const r = cards(c[0], c[1])
    expect(evaluatePick('cards35', r)).toBe(c35)
    expect(evaluatePick('cards45', r)).toBe(c45)
  })

  it('kart girilmemişse kaybetti değil, değerlendirilemedi olur', () => {
    const r = result([1, 0], [3, 1], { cornersHome: 6, cornersAway: 4 })
    expect(evaluatePick('cards35', r)).toBe('void')
    expect(evaluatePick('cards45', r)).toBe('void')
    expect(evaluatePick('corners95', r)).toBe('won')
  })
})

describe('Taraf & Gol', () => {
  const side = (ft: readonly [number, number]) => {
    const r = result([0, 0], [...ft])
    return [
      evaluatePick('homeWin15', r),
      evaluatePick('homeWin25', r),
      evaluatePick('awayWin15', r),
      evaluatePick('awayWin25', r),
    ]
  }

  it.each([
    // skor, Ev&1.5, Ev&2.5, Dep&1.5, Dep&2.5
    [[1, 0], 'lost', 'lost', 'lost', 'lost'], // ev kazandı ama tek gol
    [[2, 0], 'won', 'lost', 'lost', 'lost'], // tam 2 gol
    [[2, 1], 'won', 'won', 'lost', 'lost'], // tam 3 gol
    [[3, 0], 'won', 'won', 'lost', 'lost'],
    [[4, 3], 'won', 'won', 'lost', 'lost'],
    [[0, 1], 'lost', 'lost', 'lost', 'lost'], // deplasman kazandı ama tek gol
    [[0, 2], 'lost', 'lost', 'won', 'lost'],
    [[1, 2], 'lost', 'lost', 'won', 'won'],
    [[0, 3], 'lost', 'lost', 'won', 'won'],
    [[0, 0], 'lost', 'lost', 'lost', 'lost'], // beraberlik
    [[1, 1], 'lost', 'lost', 'lost', 'lost'], // beraberlik, 2 gol
    [[2, 2], 'lost', 'lost', 'lost', 'lost'], // beraberlik, 4 gol
    [[3, 3], 'lost', 'lost', 'lost', 'lost'],
  ] as const)('MS %j -> Ev&1.5 %s, Ev&2.5 %s, Dep&1.5 %s, Dep&2.5 %s', (ft, h15, h25, a15, a25) => {
    expect(side(ft)).toEqual([h15, h25, a15, a25])
  })

  it('maç sonucu girilmemişse değerlendirilemez; ilk yarı skoru sonucu etkilemez', () => {
    expect(evaluatePick('homeWin15', result([1, 0], null))).toBe('void')
    expect(evaluatePick('homeWin25', result([0, 2], [3, 2]))).toBe('won')
  })
})

describe('maç durumu', () => {
  const full = { cornersHome: 7, cornersAway: 6, cardsHome: 3, cardsAway: 3 }

  it.each(['pending', 'postponed', 'cancelled'] as MatchStatus[])(
    '%s maçta hiçbir kategori kazandı/kaybetti olmaz',
    (status) => {
      const r = result([1, 1], [3, 2], { ...full, status })
      for (const c of CATEGORIES) expect(evaluatePick(c.id, r)).toBe('pending')
    },
  )

  it('tamamlanan ve tüm verisi girilen maçta her kategori kazandı ya da kaybetti olur', () => {
    const r = result([1, 1], [3, 2], full)
    const outcomes = Object.fromEntries(CATEGORIES.map((c) => [c.id, evaluatePick(c.id, r)])) as Record<CategoryId, string>
    expect(outcomes).toEqual({
      over25: 'won',
      ht05: 'won',
      btts: 'won',
      over25btts: 'won',
      sh05: 'won',
      over35: 'won',
      over45: 'won',
      ht15: 'won',
      corners85: 'won',
      corners95: 'won',
      corners105: 'won',
      cards35: 'won',
      cards45: 'won',
      homeWin15: 'won',
      homeWin25: 'won',
      awayWin15: 'lost',
      awayWin25: 'lost',
    })
  })
})
