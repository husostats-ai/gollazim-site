import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { MatchResult } from '../../types'
import { collectAiMatches } from '../ai/collect'
import { buildPrompts, matchBlock } from '../ai/prompt'
import { buildPicksForResult } from '../results/freeze'
import { buildStatsSummary } from '../stats/statsSummary'
import { analyzeDay } from './engine'
import { assessReliability, estimateSampleSize, fitsPpg, isPossiblePoints, levelForSample, RELIABILITY_LIMITS, SAMPLE_HINT, sampleText } from './reliability'
import { makeMatch } from './testUtils'

describe('isPossiblePoints: n maçta alınabilecek puanlar', () => {
  const possible = (n: number) => Array.from({ length: 3 * n + 3 }, (_, p) => p).filter((p) => isPossiblePoints(p, n))
  /** Kaba kuvvet: 3 x galibiyet + beraberlik, galibiyet + beraberlik <= n */
  const brute = (n: number) => {
    const set = new Set<number>()
    for (let w = 0; w <= n; w++) for (let d = 0; w + d <= n; d++) set.add(3 * w + d)
    return [...set].sort((a, b) => a - b)
  }

  it('1 maç: 0, 1, 3; 2 maç: 0, 1, 2, 3, 4, 6', () => {
    expect(possible(1)).toEqual([0, 1, 3])
    expect(possible(2)).toEqual([0, 1, 2, 3, 4, 6])
    expect(possible(3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9])
  })

  it('genel kural kaba kuvvetle aynıdır (1–20 maç)', () => {
    for (let n = 1; n <= 20; n++) expect(possible(n), `${n} maç`).toEqual(brute(n))
  })

  it('tam sayı olmayan, eksi ya da fazla puan mümkün değildir', () => {
    expect(isPossiblePoints(1.5, 2)).toBe(false)
    expect(isPossiblePoints(-1, 2)).toBe(false)
    expect(isPossiblePoints(7, 2)).toBe(false)
  })
})

describe('fitsPpg', () => {
  it('puan hem tam sayıya yakın hem de alınabilir olmalı', () => {
    // PPG 2,00: 1 maçta 2 puan alınamaz; 2 maçta 4 puan (galibiyet + beraberlik) alınır
    expect(fitsPpg(2, 1)).toBe(false)
    expect(fitsPpg(2, 2)).toBe(true)
    expect(fitsPpg(2, 3)).toBe(true)
    // PPG 2,50: 2 maçta 5 puan alınamaz; 4 maçta 10 puan alınır
    expect(fitsPpg(2.5, 2)).toBe(false)
    expect(fitsPpg(2.5, 4)).toBe(true)
    // PPG 2,67 (yuvarlanmış 8/3): 3 maçta 8 puan alınamaz; 6 maçta 16 alınır
    expect(fitsPpg(2.67, 3)).toBe(false)
    expect(fitsPpg(2.67, 6)).toBe(true)
  })

  it('zaten geçerli olan durumlar değişmez', () => {
    expect(fitsPpg(null, 1)).toBe(true)
    expect(fitsPpg(0, 1)).toBe(true)
    expect(fitsPpg(1, 1)).toBe(true)
    expect(fitsPpg(3, 1)).toBe(true)
    expect(fitsPpg(2.33, 3)).toBe(true) // 7 puan
    expect(fitsPpg(0.5, 2)).toBe(true) // 1 puan
    expect(fitsPpg(0.5, 1)).toBe(false) // yarım puan
    expect(fitsPpg(3.5, 2)).toBe(false) // 3 x maç sayısından fazla
  })
})

describe('estimateSampleSize: gerçek CSV örnekleri', () => {
  const stats = (percents: number[], homePpg: number, awayPpg: number) => {
    const [bttsPct, over05Pct, over15Pct, over25Pct, over35Pct, over45Pct, ht05Pct, ht15Pct, sh05Pct, sh15Pct] = percents
    return { bttsPct, over05Pct, over15Pct, over25Pct, over35Pct, over45Pct, ht05Pct, ht15Pct, sh05Pct, sh15Pct, homePpg, awayPpg }
  }

  it('QPR U21 – Coventry City U21: 1 maçta 2 puan elendiği için 3 yerine 4', () => {
    // İç saha PPG 2,00 (2 maçta 4 puan), dış saha PPG 0,50 (2 maçta 1 puan)
    const match = makeMatch(stats([100, 100, 100, 100, 100, 50, 100, 75, 100, 100], 2, 0.5))
    expect(estimateSampleSize(match)).toBe(4)
    expect(assessReliability(match)).toEqual({ level: 'low', sampleSize: 4 })
  })

  it('Bristol City U21 – Charlton Athletic U21: değişmez (4)', () => {
    // İç saha PPG 2,33 (3 maçta 7 puan), dış saha PPG 1,00 (en az 1 maç)
    expect(estimateSampleSize(makeMatch(stats([100, 100, 100, 100, 100, 17, 100, 67, 100, 84], 2.33, 1)))).toBe(4)
  })

  it('puan sütunu yoksa yalnızca yüzdelere bakılır', () => {
    const { homePpg: _h, awayPpg: _a, ...onlyPercents } = stats([100, 100, 100, 100, 100, 50, 100, 75, 100, 100], 2, 0.5)
    expect(estimateSampleSize(makeMatch(onlyPercents))).toBe(3)
  })

  it('eşikler aynıdır: 8\'den az Düşük, 8–15 Orta, 16+ Yüksek', () => {
    expect(RELIABILITY_LIMITS).toEqual({ medium: 8, high: 16 })
    expect([7, 8, 15, 16].map(levelForSample)).toEqual(['low', 'medium', 'medium', 'high'])
    expect(levelForSample(null)).toBe('unknown')
  })
})

describe('etiket', () => {
  it('kartta "en az N saha maçı (tahmini)" yazar; ipucu kapsamı açıklar', () => {
    expect(sampleText(4)).toBe('en az 4 saha maçı (tahmini)')
    expect(SAMPLE_HINT).toBe(
      'Ev sahibinin iç saha + deplasmanın dış saha maçları, CSV yüzdelerinden çıkarılan tahmini alt sınır. Lig tablosundaki toplam oynanan maç sayısı değildir.',
    )
  })

  const match = makeMatch({ bttsPct: 100, over05Pct: 100, over15Pct: 100, over25Pct: 100, over35Pct: 100, over45Pct: 50, ht05Pct: 100, ht15Pct: 75, sh05Pct: 100, sh15Pct: 100, homePpg: 2, awayPpg: 0.5 })

  it('AI prompt aynı ifadeyi kullanır ve açıklar', () => {
    const items = collectAiMatches(analyzeDay([match], defaultThresholds()))
    expect(matchBlock(items[0], 1)).toContain('2.5 ÜST %100 (güvenilirlik: Düşük; en az 4 saha maçı (tahmini)')
    expect(matchBlock(items[0], 1)).not.toContain('maçlık veri')
    const [chunk] = buildPrompts(items, 'chatgpt', '6 Ekim 2026 Salı')
    expect(chunk.text).toContain(`"en az N saha maçı (tahmini)" ifadesi örneklem büyüklüğüdür: ${SAMPLE_HINT}`)
  })

  it('"Analiz için özet" güvenilirlik bölümünde kapsamı açıklar', () => {
    const picks = [{ id: 'p', matchId: 'm', categoryId: 'over25' as const, date: '2026-10-06', percent: 90, threshold: 75, outcome: 'won' as const, frozenAt: '', reliability: 'low' as const }]
    const text = buildStatsSummary({ now: new Date('2026-10-06T09:00:00Z'), today: '2026-10-06', scope: { kind: 'all' }, includeGuide: false, picks, matches: [], verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25 })
    expect(text).toContain('"en az N saha maçı (tahmini)"')
    expect(text).toContain(SAMPLE_HINT)
  })
})

describe('dondurulmuş öneriler değişmez', () => {
  const result: MatchResult = { matchId: 'x', status: 'completed', htHome: 1, htAway: 0, ftHome: 3, ftAway: 1, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '' }

  it('kayıtlı seviye ve yıldız, skor yeniden kaydedilse de aynen kalır', () => {
    // Eski hesapla "Orta" ve 4 yıldız olarak dondurulmuş bir öneri; bugünkü hesap bu maça "Düşük" der
    const match = makeMatch({ bttsPct: 100, over05Pct: 100, over15Pct: 100, over25Pct: 100, over35Pct: 100, over45Pct: 50, ht05Pct: 100, ht15Pct: 75, sh05Pct: 100, sh15Pct: 100, homePpg: 2, awayPpg: 0.5 })
    expect(assessReliability(match).level).toBe('low')
    const existing = [{ id: `${match.id}|over25`, matchId: match.id, categoryId: 'over25' as const, date: match.date, percent: 100, threshold: 75, outcome: 'won' as const, frozenAt: '2026-10-01T00:00:00Z', reliability: 'medium' as const, stars: 4 }]
    const again = buildPicksForResult({ match, dayMatches: [match], thresholds: defaultThresholds(), result: { ...result, ftHome: 0, ftAway: 0 }, existing, now: '2026-10-06T00:00:00Z' })
    expect(again).toEqual([{ ...existing[0], outcome: 'lost' }])
  })
})
