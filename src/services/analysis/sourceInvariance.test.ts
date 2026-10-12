import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds } from '../../config/categories'
import type { Match, MatchResult } from '../../types'
import { syntheticId, syntheticMatches, type ModelDataKind } from './sourceFixtures'
import { collectAiMatches } from '../ai/collect'
import { matchBlock } from '../ai/prompt'
import { buildPicksForResult } from '../results/freeze'
import { analyzeCategory, analyzeDay } from './engine'
import { buildScoreSnapshot, scoreForecast } from './scoreForecast'

// DEĞİŞMEZLİK KANITI: Model %'nin kaynağını kayda geçiren değişiklik hesabı değiştirmemelidir.
// Buradaki anlık görüntü (__snapshots__), kaynak alanı eklenmeden ÖNCEKİ kodla üretildi. Test,
// kaynak alanlarını (secondSource, modelSource) çıkardıktan sonra çıktının o görüntüyle birebir
// aynı olduğunu denetler: yüzde, model %, çelişki, yıldız, notlar, güvenilirlik, sıra, liste,
// skor olasılıkları, dondurulan öneriler ve AI prompt'u. Görüntü yeniden üretilmemelidir.

const result = (matchId: string): MatchResult => ({ matchId, status: 'completed', htHome: 1, htAway: 1, ftHome: 3, ftAway: 1, cornersHome: 6, cornersAway: 5, cardsHome: 2, cardsAway: 3, updatedAt: '2026-10-05T21:00:00.000Z' })

const SOURCE_FIELDS = ['secondSource', 'modelSource']
/** Kaynak alanları çıkarılmış kopya (iç içe tüm nesnelerde) */
export const withoutSource = <T,>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, v: unknown) => (SOURCE_FIELDS.includes(key) ? undefined : v))) as T

/** Hesabın tüm çıktıları: listeler (iki sıralama, eşik 0 ve varsayılan eşikler), skor, dondurma, prompt */
export function analysisOutputs(matches: Match[]) {
  const thresholds = defaultThresholds()
  const list = (sortMode: 'percent' | 'cautious', threshold: (id: (typeof CATEGORIES)[number]['id']) => number) =>
    CATEGORIES.map((c) => {
      const { predictions, ...rest } = analyzeCategory(matches, c.id, threshold(c.id), sortMode)
      return { ...rest, predictions: predictions.map(({ match, ...p }, i) => ({ rank: i + 1, matchId: match.id, ...p })) }
    })
  const day = analyzeDay(matches, thresholds, 'percent')
  return {
    allByPercent: list('percent', () => 0),
    allByCautious: list('cautious', () => 0),
    thresholdByPercent: list('percent', (id) => thresholds[id]),
    score: matches.map((m) => ({ id: m.id, forecast: scoreForecast(m), snapshot: buildScoreSnapshot(m, '2026-10-05T21:00:00.000Z') })),
    frozen: matches.map((m) => buildPicksForResult({ match: m, dayMatches: matches, thresholds, result: result(m.id), existing: [], now: '2026-10-05T21:00:00.000Z' })),
    frozenAtZero: matches.map((m) => buildPicksForResult({ match: m, dayMatches: matches, thresholds: Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as typeof thresholds, result: result(m.id), existing: [], now: '2026-10-05T21:00:00.000Z' })),
    prompt: collectAiMatches(day).map((item, i) => matchBlock(item, i + 1)),
  }
}

describe('değişmezlik: kaynak alanı hesabı değiştirmez', () => {
  it('sentetik 18 maç: kaynak alanları çıkarılınca tüm çıktılar değişiklik öncesiyle birebir aynı', () => {
    const outputs = analysisOutputs(syntheticMatches())
    // Senaryolar gerçekten kapsanıyor: her kategoride en az bir öneri, 18 maçın hepsi dondurulabiliyor.
    expect(outputs.allByPercent.every((c) => c.predictions.length > 0)).toBe(true)
    expect(outputs.frozenAtZero.every((picks) => picks.length > 0)).toBe(true)
    expect(withoutSource(outputs)).toMatchSnapshot()
  })
})

describe('Model %\'nin kaynağı', () => {
  const matches = syntheticMatches()
  const byId = (data: ModelDataKind) => matches.find((m) => m.id === syntheticId(data, 'full'))!
  const sourceOf = (data: ModelDataKind, categoryId: (typeof CATEGORIES)[number]['id'], odds: 'full' | 'side' | 'none' = 'full') => {
    const match = matches.find((m) => m.id === syntheticId(data, odds))!
    const prediction = analyzeCategory([match], categoryId, 0).predictions[0]
    return prediction ? { source: prediction.secondSource, percent: prediction.secondPercent } : 'liste dışı'
  }

  it('2.5 / 3.5 / 4.5 Üst: xG varsa xG; xG yoksa gol ortalaması; ikisi de yoksa model yok', () => {
    for (const id of ['over25', 'over35', 'over45'] as const) {
      expect(sourceOf('xg', id)).toMatchObject({ source: 'xg', percent: expect.any(Number) })
      expect(sourceOf('avgGoals', id)).toMatchObject({ source: 'avgGoals', percent: expect.any(Number) })
      expect(sourceOf('none', id)).toEqual({ source: 'none', percent: null })
    }
  })

  it('xG 0 gelirse "veri yok" sayılır: gol ortalamasına düşülür; o da 0 ise model yok; tek takımın xG\'si 0 ise xG kullanılmaz', () => {
    expect(sourceOf('zeroXg', 'over25')).toMatchObject({ source: 'avgGoals', percent: expect.any(Number) })
    expect(sourceOf('halfXg', 'over25')).toMatchObject({ source: 'avgGoals', percent: expect.any(Number) })
    expect(sourceOf('zeroBoth', 'over25')).toEqual({ source: 'none', percent: null })
  })

  it('KG Var: yalnızca xG; gol ortalamasına HİÇ düşülmez', () => {
    expect(sourceOf('xg', 'btts')).toMatchObject({ source: 'xg', percent: expect.any(Number) })
    for (const data of ['avgGoals', 'none', 'zeroXg', 'halfXg', 'zeroBoth'] as const) expect(sourceOf(data, 'btts')).toEqual({ source: 'none', percent: null })
    expect(matches.every((m) => analyzeCategory([m], 'btts', 0).predictions.every((p) => p.secondSource !== 'avgGoals'))).toBe(true)
  })

  it('Taraf & Gol: ikinci hesap (xG modeli) yalnızca xG\'dendir; xG yoksa ya da ana hesap zaten xG ise yoktur', () => {
    for (const id of ['homeWin15', 'homeWin25', 'awayWin15', 'awayWin25'] as const) {
      expect(sourceOf('xg', id, 'full')).toMatchObject({ source: 'xg', percent: expect.any(Number) })
      expect(sourceOf('xg', id, 'side')).toMatchObject({ source: 'xg', percent: expect.any(Number) })
      // Oran yok: ana hesap xG'nin kendisidir, ikinci hesap yapılmaz.
      expect(sourceOf('xg', id, 'none')).toEqual({ source: 'none', percent: null })
      expect(sourceOf('avgGoals', id, 'full')).toEqual({ source: 'none', percent: null })
      expect(sourceOf('zeroXg', id, 'side')).toEqual({ source: 'none', percent: null })
      // Oran da xG de yok: maç listeye girmez.
      expect(sourceOf('avgGoals', id, 'none')).toBe('liste dışı')
    }
  })

  it('ikinci hesabı olmayan kategorilerde kaynak alanı yoktur (2.5 Üst & KG Var, yarı, korner, kart)', () => {
    for (const id of ['over25btts', 'ht05', 'sh05', 'ht15', 'corners85', 'corners95', 'corners105', 'cards35', 'cards45'] as const)
      for (const p of analyzeCategory(matches, id, 0).predictions) expect('secondSource' in p).toBe(false)
    // 2.5 Üst & KG Var'ın ana yüzdesi xG'dendir: xG yoksa maç listeye girmez (fallback yok).
    expect(analyzeCategory(matches, 'over25btts', 0).predictions.map((p) => p.match.id).sort()).toEqual((['full', 'none', 'side'] as const).map((odds) => syntheticId('xg', odds)).sort())
  })

  it('kaynak yalnızca bilgidir: kaynağı farklı iki maçta aynı hazır yüzde, aynı eşik kararı ve aynı sıra kuralı geçerlidir', () => {
    const list = analyzeCategory(matches, 'over25', 0).predictions
    // Sıra yalnızca hazır yüzdeye göredir (her maçta bir puan düşer); kaynak sırayı etkilemez.
    expect(list.map((p) => p.percent)).toEqual([...list.map((p) => p.percent)].sort((a, b) => b - a))
    expect(new Set(list.map((p) => p.secondSource))).toEqual(new Set(['xg', 'avgGoals', 'none']))
  })

  describe('dondurma', () => {
    const thresholds = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as ReturnType<typeof defaultThresholds>
    const freeze = (match: Match, existing: ReturnType<typeof buildPicksForResult> = []) => buildPicksForResult({ match, dayMatches: matches, thresholds, result: result(match.id), existing, now: '2026-10-05T21:00:00.000Z' })
    const source = (data: ModelDataKind, categoryId: string) => freeze(byId(data)).find((p) => p.categoryId === categoryId)?.modelSource

    it('kaynak öneri kaydına yazılır: xG / ort. gol / model yok', () => {
      expect(source('xg', 'over25')).toBe('xg')
      expect(source('avgGoals', 'over25')).toBe('avgGoals')
      expect(source('zeroXg', 'over35')).toBe('avgGoals')
      expect(source('none', 'over45')).toBe('none')
      expect(source('xg', 'btts')).toBe('xg')
      expect(source('avgGoals', 'btts')).toBe('none')
      expect(source('xg', 'homeWin15')).toBe('xg')
      expect(source('avgGoals', 'homeWin15')).toBe('none')
    })

    it('kayıtta kaynak ile model yüzdesi tutarlıdır: "model yok" ancak ve ancak yüzde null ise', () => {
      for (const match of matches) for (const pick of freeze(match)) if ('modelSource' in pick) expect(pick.modelSource === 'none').toBe(pick.secondPercent === null)
    })

    it('ikinci hesabı olmayan kategorilerin kaydına alan yazılmaz', () => {
      const picks = freeze(byId('xg'))
      for (const id of ['over25btts', 'ht05', 'sh05', 'corners85', 'cards35']) {
        const pick = picks.find((p) => p.categoryId === id)!
        expect(pick).toBeDefined()
        expect('modelSource' in pick).toBe(false)
      }
    })

    it('skor yeniden girilince kaynak korunur; kaynağı olmayan eski kayda sonradan kaynak YAZILMAZ', () => {
      const frozen = freeze(byId('avgGoals'))
      expect(freeze(byId('avgGoals'), frozen).map((p) => p.modelSource)).toEqual(frozen.map((p) => p.modelSource))
      const old = frozen.map(({ modelSource: _unused, ...rest }) => rest)
      const again = freeze(byId('avgGoals'), old)
      expect(again.every((p) => !('modelSource' in p))).toBe(true)
      expect(again).toEqual(old)
    })
  })
})
