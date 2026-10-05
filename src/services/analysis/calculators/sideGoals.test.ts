import { describe, expect, it } from 'vitest'
import { starsFor } from '../confidence'
import { analyzeCategory } from '../engine'
import { makeMatch } from '../testUtils'
import { CONFLICT_MAX_STARS, DRIFT_MAX_STARS } from './sideGoals'

// Piyasa: ev net favori, bol gollü. Model piyasayı 3 puan içinde tutturur.
const market = { oddsHome: 1.15, oddsDraw: 9, oddsAway: 17, oddsOver25: 1.35, oddsUnder25: 3.2 }
// xG tersini söylüyor: çelişki
const clashingXg = { homeXg: 0.8, awayXg: 1.9 }
const agreeingXg = { homeXg: 3.0, awayXg: 0.6 }
// Piyasa beraberliğe çok düşük olasılık veriyor; bağımsız Poisson bunu tutturamaz
const lowDrawMarket = { oddsHome: 1.2, oddsDraw: 30, oddsAway: 9, oddsOver25: 1.35, oddsUnder25: 3.2 }
const SIDE_15_STEPS = [70, 65, 60, 55] as const
/** Hiçbir üst sınır uygulanmasaydı yüzdenin alacağı yıldız */
const uncapped = (percent: number) => starsFor(percent, 'market', SIDE_15_STEPS)
// Yüzdeleri 1/20 adımlı: örneklem orta/yüksek. 1/6 adımlı: düşük.
const strongSample = { bttsPct: 65, over15Pct: 85, over35Pct: 35, ht05Pct: 55, over25Pct: 70 }
const weakSample = { bttsPct: 67, over15Pct: 84, over35Pct: 33, ht05Pct: 50, over25Pct: 67 }

const predict = (stats: Record<string, number | null>, id: 'homeWin15' | 'homeWin25' | 'awayWin15' = 'homeWin15') =>
  analyzeCategory([makeMatch(stats)], id, 0).predictions[0]
const kinds = (p: ReturnType<typeof predict>) => p.notes.map((n) => n.kind)

describe('Taraf & Gol hesaplayıcısı', () => {
  it('piyasa tabanlı yüzde, ikinci (xG) yüzde ve kaynak etiketi üretir', () => {
    const p = predict({ ...market, ...agreeingXg })
    expect(p.reliability).toEqual({ level: 'market', sampleSize: null })
    expect(p.basis).toBe('piyasa + gol modeli')
    expect(p.secondPercent).toBeTypeOf('number')
    expect(p.conflict).toBe(false)
    expect(p.notes).toEqual([])
    expect(p.cautiousPercent).toBeNull()
  })

  it('örneklem sınırı uygulanmaz: yüksek yüzde 5 yıldız alabilir', () => {
    const p = predict({ ...market, ...agreeingXg, ...weakSample })
    expect(p.percent).toBeGreaterThanOrEqual(70)
    expect(p.notes).toEqual([])
    expect(p.stars).toBe(5)
  })

  it('çelişki + xG örneklemi orta/yüksek: yıldız 2 ile sınırlanır', () => {
    const p = predict({ ...market, ...clashingXg, ...strongSample })
    expect(p.conflict).toBe(true)
    expect(kinds(p)).toEqual(['conflict'])
    expect(uncapped(p.percent)).toBeGreaterThan(CONFLICT_MAX_STARS)
    expect(p.stars).toBe(CONFLICT_MAX_STARS)
  })

  it('çelişki + xG örneklemi düşük: rozet görünür, "xG zayıf" notu çıkar, yıldız düşmez', () => {
    const p = predict({ ...market, ...clashingXg, ...weakSample })
    expect(p.conflict).toBe(true)
    expect(kinds(p)).toEqual(['conflict', 'weak-xg'])
    expect(p.stars).toBe(uncapped(p.percent))
    expect(p.stars).toBeGreaterThan(CONFLICT_MAX_STARS)
  })

  it('örneklem çıkarılamıyorsa da çelişki yıldızı düşürmez', () => {
    const p = predict({ ...market, ...clashingXg })
    expect(kinds(p)).toEqual(['conflict', 'weak-xg'])
    expect(p.stars).toBe(uncapped(p.percent))
  })

  it('Alt/Üst oranı yoksa rozet "Piyasa (kısmi)" olur', () => {
    const p = predict({ oddsHome: 1.15, oddsDraw: 9, oddsAway: 17, ...agreeingXg, avgGoals: 3.2 })
    expect(p.reliability.level).toBe('market-partial')
    expect(p.basis).toBe('piyasa (1X2) + gol beklentisi tahmini')
  })

  it('model 1X2 olasılıklarını piyasadan 3 puandan fazla saptırıyorsa yıldız 3 ile sınırlanır ve uyarı çıkar', () => {
    const p = predict({ ...lowDrawMarket, ...agreeingXg })
    expect(kinds(p)).toEqual(['model-drift'])
    expect(uncapped(p.percent)).toBeGreaterThan(DRIFT_MAX_STARS)
    expect(p.stars).toBe(DRIFT_MAX_STARS)
  })

  it('çelişki ve sapma birlikteyse düşük olan sınır geçerlidir', () => {
    const p = predict({ ...lowDrawMarket, ...clashingXg, ...strongSample })
    expect(kinds(p)).toEqual(['conflict', 'model-drift'])
    expect(p.stars).toBe(CONFLICT_MAX_STARS)
  })

  it('oran yoksa yalnızca xG kullanır ve örneklem rozetine döner', () => {
    const p = predict({ ...agreeingXg, ...weakSample })
    expect(p.basis).toBe('yalnızca xG modeli')
    expect(p.reliability.level).toBe('low')
    expect(p.secondPercent).toBeNull()
    expect(p.stars).toBeLessThanOrEqual(3)
  })

  it('hiçbir kaynak yoksa maç listeye girmez ve eksik alanlar bildirilir', () => {
    const a = analyzeCategory([makeMatch({ over25Pct: 90 })], 'homeWin15', 0)
    expect(a.predictions).toEqual([])
    expect(a.unavailableCount).toBe(1)
    expect(a.missingFields).toContain('oddsHome')
  })

  it('eşik ana yüzdeye uygulanır, sıralama ana yüzdeye göredir', () => {
    const strong = makeMatch({ ...market, ...agreeingXg })
    const even = makeMatch({ oddsHome: 2.6, oddsDraw: 3.3, oddsAway: 2.7, oddsOver25: 1.9, oddsUnder25: 1.9, ...agreeingXg })
    const a = analyzeCategory([even, strong], 'homeWin15', 55)
    expect(a.predictions.map((p) => p.match.id)).toEqual([strong.id])
    expect(analyzeCategory([even, strong], 'homeWin15', 0).predictions.map((p) => p.match.id)).toEqual([strong.id, even.id])
  })
})
