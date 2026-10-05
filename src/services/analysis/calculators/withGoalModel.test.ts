import { describe, expect, it } from 'vitest'
import { analyzeCategory } from '../engine'
import { MODEL_CONFLICT_LIMIT, MODEL_CONFLICT_MAX_STARS } from '../goalModel'
import { makeMatch } from '../testUtils'

// xG toplamı 3,0 -> model: 2.5 Üst %58, 3.5 Üst %35, 4.5 Üst %18; KG Var (1,8 / 1,2) %58
const xg = { homeXg: 1.8, awayXg: 1.2 }
// Yüzdeleri 1/20 adımlı: örneklem orta/yüksek. 1/6 adımlı: düşük.
const strongSample = { bttsPct: 65, over15Pct: 85, over35Pct: 35, ht05Pct: 55 }
const weakSample = { bttsPct: 67, over15Pct: 84, over35Pct: 33, ht05Pct: 50 }

const predict = (stats: Record<string, number | null>, id: 'over25' | 'over35' | 'over45' | 'btts' = 'over25') =>
  analyzeCategory([makeMatch(stats)], id, 0).predictions[0]
const kinds = (p: ReturnType<typeof predict>) => p.notes.map((n) => n.kind)

describe('ana gol kategorilerinde model yüzdesi', () => {
  it('sınır 25 puandır', () => {
    expect(MODEL_CONFLICT_LIMIT).toBe(25)
    expect(MODEL_CONFLICT_MAX_STARS).toBe(3)
  })

  it('ana yüzdeyi değiştirmez; modeli ikinci yüzde olarak ekler', () => {
    const p = predict({ ...xg, over25Pct: 70 })
    expect(p.percent).toBe(70)
    expect(p).toMatchObject({ secondPercent: 58, secondLabel: 'Model', conflict: false, notes: [] })
    expect(p.basis).toBe('CSV: 2.5 Üst yüzdesi')
  })

  it('dört kategoride de hesaplanır', () => {
    const stats = { ...xg, over25Pct: 60, over35Pct: 40, over45Pct: 20, bttsPct: 60 }
    expect(predict(stats, 'over25').secondPercent).toBe(58)
    expect(predict(stats, 'over35').secondPercent).toBe(35)
    expect(predict(stats, 'over45').secondPercent).toBe(18)
    expect(predict(stats, 'btts').secondPercent).toBe(58)
  })

  it('fark tam 25 puansa çelişki değildir, 26 puansa çelişkidir (iki yönde de)', () => {
    expect(predict({ ...xg, over25Pct: 83 })).toMatchObject({ conflict: false, notes: [] }) // 83 - 58 = 25
    expect(predict({ ...xg, over25Pct: 84 }).conflict).toBe(true) // 26
    expect(predict({ ...xg, over25Pct: 33 }).conflict).toBe(false) // 58 - 33 = 25
    expect(predict({ ...xg, over25Pct: 32 }).conflict).toBe(true)
    // 15-25 puan arası artık rozet çıkarmaz
    expect(predict({ ...xg, over25Pct: 78 })).toMatchObject({ conflict: false, notes: [] })
  })

  it('çelişki + örneklem orta/yüksek: rozet çıkar, yıldız en fazla 3', () => {
    const p = predict({ ...strongSample, ...xg, over25Pct: 90 })
    expect(['medium', 'high']).toContain(p.reliability.level)
    expect(kinds(p)).toEqual(['conflict'])
    expect(p.notes[0].label).toBe('Model çelişkisi')
    expect(p.stars).toBe(3)
    // çelişki olmasaydı aynı örneklemle daha fazla yıldız alırdı
    expect(predict({ ...strongSample, homeXg: 2.6, awayXg: 1.9, over25Pct: 90 }).stars).toBeGreaterThan(3)
  })

  it('çelişki + örneklem düşük: rozet ve "xG zayıf" notu çıkar, yıldız mevcut kuralla aynı kalır', () => {
    const conflicted = predict({ ...weakSample, ...xg, over25Pct: 100 })
    const calm = predict({ ...weakSample, homeXg: 2.6, awayXg: 1.9, over25Pct: 100 })
    expect(conflicted.reliability.level).toBe('low')
    expect(kinds(conflicted)).toEqual(['conflict', 'weak-xg'])
    expect(conflicted.stars).toBe(calm.stars)
    expect(conflicted.stars).toBe(3)
  })

  it('çelişki yoksa yıldız kuralı hiç değişmez', () => {
    const withModel = predict({ ...strongSample, ...xg, over25Pct: 80 })
    const withoutModel = predict({ ...strongSample, over25Pct: 80 })
    expect(withModel.conflict).toBe(false)
    expect(withModel.stars).toBe(withoutModel.stars)
  })

  it('model hesaplanamıyorsa maç ana yüzdeyle yine listelenir', () => {
    const p = predict({ over25Pct: 90 })
    expect(p).toMatchObject({ percent: 90, secondPercent: null, notes: [] })
    expect(p.conflict).toBeUndefined()
    // KG Var: xG yok, gol ortalaması var -> model yok ama maç listede
    expect(predict({ bttsPct: 85, avgGoals: 3.4 }, 'btts')).toMatchObject({ percent: 85, secondPercent: null })
  })

  it('eşik ve sıralama hazır yüzdeye göre kalır', () => {
    const highReady = makeMatch({ over25Pct: 90, homeXg: 0.9, awayXg: 0.8 }) // model düşük
    const lowReady = makeMatch({ over25Pct: 76, homeXg: 2.6, awayXg: 2.0 }) // model yüksek
    const belowThreshold = makeMatch({ over25Pct: 60, homeXg: 3, awayXg: 3 }) // model çok yüksek ama eşik altı
    const a = analyzeCategory([lowReady, belowThreshold, highReady], 'over25', 75)
    expect(a.predictions.map((p) => p.match.id)).toEqual([highReady.id, lowReady.id])
  })

  it('diğer kategorilere dokunmaz', () => {
    const stats = { ...xg, ht05Pct: 90, ht15Pct: 70, sh05Pct: 90, corners85Pct: 90, avgCards: 6 }
    for (const id of ['ht05', 'ht15', 'sh05', 'corners85', 'cards35', 'over25btts'] as const) {
      const [p] = analyzeCategory([makeMatch(stats)], id, 0).predictions
      expect(p.secondPercent).toBeUndefined()
      expect(p.notes).toEqual([])
    }
  })
})
