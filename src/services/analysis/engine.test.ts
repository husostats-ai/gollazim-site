import { describe, expect, it } from 'vitest'
import { MAX_MATCHES_PER_CATEGORY } from '../../config/categories'
import { cautiousPercent } from './cautious'
import { starsFor } from './confidence'
import { analyzeCategory } from './engine'
import { makeMatch } from './testUtils'

describe('analyzeCategory', () => {
  it('eşiğin altındaki maçları göstermez ve yüzdeye göre sıralar', () => {
    const matches = [70, 90, 74, 75, 82].map((p) => makeMatch({ over25Pct: p }))
    const result = analyzeCategory(matches, 'over25', 75)
    expect(result.predictions.map((p) => p.percent)).toEqual([90, 82, 75])
    expect(result.evaluatedCount).toBe(5)
  })

  it('en fazla 15 maç gösterir, listeyi doldurmak için zayıf maç eklemez', () => {
    const many = Array.from({ length: 40 }, (_, i) => makeMatch({ over25Pct: 60 + i }))
    const result = analyzeCategory(many, 'over25', 75)
    expect(result.predictions).toHaveLength(MAX_MATCHES_PER_CATEGORY)
    expect(result.qualifiedCount).toBe(25)
    expect(result.predictions[0].percent).toBe(99)
    expect(result.predictions.at(-1)!.percent).toBe(85)

    const few = analyzeCategory(many.slice(0, 22), 'over25', 75)
    expect(few.predictions).toHaveLength(7)
  })

  it('istatistiği olmayan maça yüzde uydurmaz, eksik alanı bildirir', () => {
    const matches = [makeMatch({ over25Pct: 90 }), makeMatch({ over25Pct: null }), makeMatch({})]
    const result = analyzeCategory(matches, 'over25', 50)
    expect(result.predictions).toHaveLength(1)
    expect(result.unavailableCount).toBe(2)
    expect(result.missingFields).toEqual(['over25Pct'])
  })

  it('eşit yüzdede örneklemi büyük olan maç öne geçer', () => {
    // İlk maç: yüzdeler 1/6 adımlı (küçük örneklem). İkinci: 1/20 adımlı.
    const small = makeMatch({ over25Pct: 100, bttsPct: 67, over15Pct: 84, over35Pct: 33, ht05Pct: 50 })
    const large = makeMatch({ over25Pct: 100, bttsPct: 65, over15Pct: 85, over35Pct: 35, ht05Pct: 55 })
    const result = analyzeCategory([small, large], 'over25', 75)
    expect(result.predictions.map((p) => p.match.id)).toEqual([large.id, small.id])
    expect(result.predictions[0].reliability.sampleSize).toBeGreaterThan(result.predictions[1].reliability.sampleSize!)
  })

  it('kart: ortalama 0 veri yok sayılır, Poisson ile hesaplanır', () => {
    const matches = [makeMatch({ avgCards: 0 }), makeMatch({ avgCards: 5 })]
    const over35 = analyzeCategory(matches, 'cards35', 0)
    expect(over35.unavailableCount).toBe(1)
    expect(over35.predictions[0].percent).toBe(73)
    expect(analyzeCategory(matches, 'cards45', 0).predictions[0].percent).toBe(56)
  })

  it('2.5 Üst & KG Var xG yoksa hesaplanmaz', () => {
    const matches = [makeMatch({ homeXg: 2.36, awayXg: 1.39 }), makeMatch({ homeXg: 0, awayXg: 1.2 })]
    const result = analyzeCategory(matches, 'over25btts', 0)
    expect(result.predictions.map((p) => p.percent)).toEqual([60])
    expect(result.missingFields).toEqual(['homeXg'])
  })
})

describe('temkinli sıra', () => {
  // small: 1/6 adımlı yüzdeler (küçük örneklem), large: 1/20 adımlı (daha büyük örneklem)
  const small = { bttsPct: 67, over15Pct: 84, over35Pct: 33, ht05Pct: 50 }
  const large = { bttsPct: 65, over15Pct: 85, over35Pct: 35, ht05Pct: 55 }

  it('Wilson alt sınırını hesaplar, örneklem yoksa null döner', () => {
    expect(cautiousPercent(100, 4)).toBe(60)
    expect(cautiousPercent(84, 18)).toBe(66)
    expect(cautiousPercent(0, 10)).toBe(0)
    expect(cautiousPercent(90, null)).toBeNull()
  })

  it('büyük örneklemli maçı öne alır ama ham yüzdeyi ve eşiği değiştirmez', () => {
    const a = makeMatch({ ...small, over25Pct: 100 })
    const b = makeMatch({ ...large, over25Pct: 90 })
    const c = makeMatch({ ...large, over25Pct: 70 })
    const byPercent = analyzeCategory([a, b, c], 'over25', 75)
    const cautious = analyzeCategory([a, b, c], 'over25', 75, 'cautious')
    expect(byPercent.predictions.map((p) => p.match.id)).toEqual([a.id, b.id])
    expect(cautious.predictions.map((p) => p.match.id)).toEqual([b.id, a.id])
    expect(cautious.predictions.map((p) => p.percent)).toEqual([90, 100])
    expect(cautious.predictions.map((p) => p.cautiousPercent)).toEqual([67, 60])
  })

  it('korner ve kartta güvenilirlik ölçülemedi görünür, temkinli yüzde üretilmez', () => {
    const m = makeMatch({ ...large, corners85Pct: 90, avgCards: 6 })
    for (const id of ['corners85', 'cards35'] as const) {
      const [p] = analyzeCategory([m], id, 0, 'cautious').predictions
      expect(p.reliability).toEqual({ level: 'unmeasured', sampleSize: null })
      expect(p.cautiousPercent).toBeNull()
      expect(p.stars).toBeLessThanOrEqual(3)
    }
  })
})

describe('starsFor', () => {
  it('yüzdeye göre yıldız verir, düşük güvenilirlikte üst sınır uygular', () => {
    expect(starsFor(84, 'high')).toBe(5)
    expect(starsFor(76, 'high')).toBe(4)
    expect(starsFor(100, 'medium')).toBe(4)
    expect(starsFor(100, 'low')).toBe(3)
    expect(starsFor(65, 'low')).toBe(2)
    expect(starsFor(40, 'high')).toBe(1)
    expect(starsFor(66, 'high', [70, 65, 60, 55])).toBe(4)
  })
})
