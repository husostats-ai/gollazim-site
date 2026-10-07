import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { Match, StatValue } from '../../types'
import { collectAiMatches } from '../ai/collect'
import { buildPrompts, matchBlock } from '../ai/prompt'
import { CALCULATORS } from './calculators'
import { analyzeDay } from './engine'
import { goalModelPercent } from './goalModel'
import { scoreForecast } from './scoreForecast'
import { buildSideGoalsModel } from './sideGoals/sideGoals'
import { statSummary } from './summary'
import { makeMatch } from './testUtils'
import { usableXg, XG_MISSING_TEXT } from './xgAvailability'

// Eksik xG'nin GÖSTERİMİ: kaynakta "0" olarak gelen xG kartta ve yapay zekâ isteminde
// "veri yok" yazılır. Hesaplar değişmez; dolu xG'li maçların metni de değişmez.

const BASE: Record<string, StatValue> = {
  over25Pct: 90,
  bttsPct: 85,
  avgGoals: 3.75,
  avgCorners: 9.5,
  avgCards: 4.2,
  homePpg: 1.8,
  awayPpg: 1.1,
  oddsHome: 1.5,
  oddsDraw: 4.2,
  oddsAway: 6.5,
  oddsOver25: 1.7,
  oddsUnder25: 2.1,
}
const withXg = (home: StatValue | undefined, away: StatValue | undefined, id: string): Match =>
  makeMatch({ ...BASE, ...(home !== undefined && { homeXg: home }), ...(away !== undefined && { awayXg: away }) }, { id, home: 'Ev Takımı', away: 'Dep Takımı', time: '20:00', league: 'Testland · Deneme Ligi' })

const CASES: [string, StatValue | undefined, StatValue | undefined, boolean][] = [
  ['iki taraf dolu', 1.6, 1.1, true],
  ['ikisi de 0', 0, 0, false],
  ['ev sahibi 0', 0, 1.31, false],
  ['deplasman 0', 1.9, 0, false],
  ['negatif', -1, 1.2, false],
  ['ikisi de yok', undefined, undefined, false],
  ['biri yok', 1.4, undefined, false],
  ['boş değer', null, null, false],
]

const blockOf = (match: Match): string => {
  const items = collectAiMatches(analyzeDay([match], defaultThresholds(), 'percent'))
  expect(items).toHaveLength(1)
  return matchBlock(items[0], 1)
}
const xgLine = (block: string): string => /Maç öncesi xG: [^;]*/.exec(block)![0].trim()

describe('usableXg: gösterimdeki kural hesaplardaki kuralla aynıdır', () => {
  it.each(CASES)('%s', (_, home, away, usable) => {
    const match = withXg(home, away, 'm')
    expect(usableXg(match) !== null).toBe(usable)
    // KG Var modeli yalnızca xG ile hesaplanır: xG kullanılabilirse var, değilse yok.
    expect(goalModelPercent(match, 'btts') !== null).toBe(usable)
    // 2.5 Üst & KG Var yalnızca xG ile hesaplanır.
    expect(CALCULATORS.over25btts.calculate(match).ok).toBe(usable)
    // Taraf & Gol'ün ikinci hesabı xG'dir.
    expect(buildSideGoalsModel(match)!.second !== null).toBe(usable)
  })

  it('kullanılabilir xG değerleri aynen döner', () => {
    expect(usableXg(withXg(1.6, 1.1, 'm'))).toEqual({ home: 1.6, away: 1.1 })
    expect(XG_MISSING_TEXT).toBe('veri yok')
  })
})

describe('admin kartındaki özet satırı', () => {
  const xgItem = (match: Match) => statSummary(match, 'over25').find((i) => i.label === 'xG')

  it('dolu xG eskisi gibi yazılır', () => {
    expect(xgItem(withXg(1.6, 1.1, 'm'))).toEqual({ label: 'xG', value: '1,6 – 1,1' })
    expect(statSummary(withXg(1.6, 1.1, 'm'), 'over25')).toEqual([
      { label: 'Gol ort.', value: '3,75' },
      { label: 'xG', value: '1,6 – 1,1' },
    ])
  })

  it('eksik xG "0 – 0" yerine "veri yok" yazılır (tek taraf 0 ise de)', () => {
    for (const [home, away] of [[0, 0], [0, 1.31], [1.9, 0], [-1, 1.2]]) expect(xgItem(withXg(home, away, 'm')), `${home}-${away}`).toEqual({ label: 'xG', value: 'veri yok' })
  })

  it('xG kolonu hiç yoksa satır eskisi gibi hiç yazılmaz; diğer satırlar etkilenmez', () => {
    expect(xgItem(withXg(undefined, undefined, 'm'))).toBeUndefined()
    expect(statSummary(withXg(0, 0, 'm'), 'over25')[0]).toEqual({ label: 'Gol ort.', value: '3,75' })
    // Korner ve kart kartlarında xG satırı zaten yoktur.
    expect(statSummary(withXg(0, 0, 'm'), 'corners85').some((i) => i.label === 'xG')).toBe(false)
  })
})

describe('yapay zekâ istemi', () => {
  it('dolu xG satırı ve bloğun tamamı eskisiyle birebir aynıdır', () => {
    const block = blockOf(withXg(1.6, 1.1, 'dolu'))
    expect(xgLine(block)).toBe('Maç öncesi xG: ev 1,6 / deplasman 1,1')
    // İstatistik satırının tamamı sabitlenir: dolu xG'li maçta hiçbir şey değişmedi.
    expect(block.split('\n').find((l) => l.startsWith('İstatistik:'))).toBe(
      'İstatistik: Gol ortalaması: 3,75 ; Korner ortalaması: 9,5 ; Kart ortalaması: 4,2 ; Maç başı puan (PPG): ev 1,8 / deplasman 1,1 ; Maç öncesi xG: ev 1,6 / deplasman 1,1 ; 1X2 oranları: 1,5 / 4,2 / 6,5',
    )
  })

  it('eksik xG "ev 0 / deplasman 0" yerine "veri yok" yazılır', () => {
    for (const [home, away] of [[0, 0], [0, 1.31], [1.9, 0], [-1, 1.2]]) {
      const block = blockOf(withXg(home, away, 'eksik'))
      expect(xgLine(block), `${home}-${away}`).toBe('Maç öncesi xG: veri yok')
      expect(block).not.toMatch(/ev 0 \/|deplasman 0( |$)|ev -1/m)
    }
  })

  it('0 olarak gelen xG, istemde hiç gelmemiş xG ile birebir aynı bloğu verir', () => {
    // Hesaplar ikisini de "veri yok" saydığı için öneri, model ve piyasa satırları da aynıdır.
    expect(blockOf(withXg(0, 0, 'ayni'))).toBe(blockOf(withXg(undefined, undefined, 'ayni')))
    expect(blockOf(withXg(1.9, 0, 'ayni'))).toBe(blockOf(withXg(undefined, undefined, 'ayni')))
  })

  it('eksik xG yalnızca xG satırını değiştirir: aynı maçın dolu xG\'li hâliyle diğer istatistikler aynıdır', () => {
    const stats = (block: string) => block.split('\n').find((l) => l.startsWith('İstatistik:'))!.replace(/Maç öncesi xG: [^;]*;/, 'Maç öncesi xG: X ;')
    expect(stats(blockOf(withXg(0, 0, 'm')))).toBe(stats(blockOf(withXg(1.6, 1.1, 'm'))))
    // İstemin kuralları ve cevap biçimi değişmedi; "veri yok" için tahmin yürütülmemesi kuralı duruyor.
    const [chunk] = buildPrompts(collectAiMatches(analyzeDay([withXg(0, 0, 'm')], defaultThresholds(), 'percent')), 'chatgpt', '7 Ekim 2026 Çarşamba')
    expect(chunk.text).toContain('- "veri yok" yazan alanlar için tahmin yürütme.')
    expect(chunk.text).toContain('Maç öncesi xG: veri yok')
  })
})

describe('hesaplar değişmedi: eksik xG eskisi gibi dışlanır, 0 olarak girmez', () => {
  it('0 xG ile xG\'siz maç aynı yüzdeleri, yıldızları ve skor olasılıklarını verir', () => {
    const zero = withXg(0, 0, 'm')
    const none = withXg(undefined, undefined, 'm')
    const strip = (match: Match) => {
      const day = analyzeDay([match], defaultThresholds(), 'percent')
      return Object.values(day).map((a) => a.predictions.map(({ match: _, ...p }) => p))
    }
    expect(strip(zero)).toEqual(strip(none))
    expect(scoreForecast(zero)).toEqual(scoreForecast(none))
    // Model yüzdesi gol ortalamasına düşer (xG 0 girseydi %0 çıkardı).
    expect(goalModelPercent(zero, 'over25')).toEqual({ percent: 72, source: 'avgGoals' })
    expect(goalModelPercent(withXg(1.6, 1.1, 'm'), 'over25')!.source).toBe('xg')
  })
})
