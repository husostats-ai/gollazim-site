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
import { expectedTotalGoals } from './goalModel'
import { STAT_MISSING_TEXT, usableAvgCards, usableAvgCorners, usableAvgGoals, usableXg } from './statAvailability'

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
    expect(STAT_MISSING_TEXT).toBe('veri yok')
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

// ───────── Gol ortalaması ─────────

const withAvg = (avgGoals: StatValue | undefined, id: string, extra: Record<string, StatValue> = {}): Match => {
  const { avgGoals: _, ...rest } = BASE
  return makeMatch({ ...rest, ...(avgGoals !== undefined && { avgGoals }), ...extra }, { id, home: 'Ev Takımı', away: 'Dep Takımı', time: '20:00', league: 'Testland · Deneme Ligi' })
}
const AVG_CASES: [string, StatValue | undefined, boolean][] = [
  ['dolu', 3.75, true],
  ['çok küçük ama pozitif', 0.01, true],
  ['0', 0, false],
  ['negatif', -1, false],
  ['kolon yok', undefined, false],
  ['boş değer', null, false],
]
const avgLine = (block: string): string => /Gol ortalaması: [^;]*/.exec(block)![0].trim()

describe('usableAvgGoals: gösterimdeki kural hesaplardaki kuralla aynıdır', () => {
  it.each(AVG_CASES)('%s', (_, avgGoals, usable) => {
    // xG'siz maç: gol modeli yalnızca gol ortalamasına bakar.
    const match = withAvg(avgGoals, 'm')
    expect(usableAvgGoals(match) !== null).toBe(usable)
    expect(expectedTotalGoals(match) !== null).toBe(usable)
    expect(goalModelPercent(match, 'over25') !== null).toBe(usable)
    if (usable) expect(expectedTotalGoals(match)).toEqual({ total: avgGoals, source: 'avgGoals' })
    // Taraf & Gol: 2.5 Alt/Üst oranı ve xG yokken toplam gol yalnızca gol ortalamasından tahmin edilir.
    const { oddsOver25: _o, oddsUnder25: _u, ...noTotals } = BASE
    const sideOnly = makeMatch({ ...noTotals, avgGoals: avgGoals ?? null }, { id: 's' })
    expect(buildSideGoalsModel(sideOnly) !== null).toBe(usable)
  })
})

describe('admin kartı: gol ortalaması', () => {
  const avgItem = (match: Match) => statSummary(match, 'over25').find((i) => i.label === 'Gol ort.')

  it('dolu gol ortalaması eskisi gibi yazılır', () => {
    expect(avgItem(withAvg(3.75, 'm'))).toEqual({ label: 'Gol ort.', value: '3,75' })
    expect(avgItem(withAvg(0.01, 'm'))).toEqual({ label: 'Gol ort.', value: '0,01' })
  })

  it('0 ya da negatif gol ortalaması "veri yok" yazılır', () => {
    for (const value of [0, -1, -0.5]) expect(avgItem(withAvg(value, 'm')), String(value)).toEqual({ label: 'Gol ort.', value: 'veri yok' })
  })

  it('kolon hiç yoksa satır eskisi gibi hiç yazılmaz; xG satırı ve diğer kartlar etkilenmez', () => {
    expect(avgItem(withAvg(undefined, 'm'))).toBeUndefined()
    expect(avgItem(withAvg(null, 'm'))).toBeUndefined()
    expect(statSummary(withAvg(0, 'm', { homeXg: 1.6, awayXg: 1.1 }), 'over25')).toEqual([
      { label: 'Gol ort.', value: 'veri yok' },
      { label: 'xG', value: '1,6 – 1,1' },
    ])
    // Korner ve kart kartlarında gol ortalaması satırı zaten yoktur.
    expect(statSummary(withAvg(0, 'm'), 'corners85').some((i) => i.label === 'Gol ort.')).toBe(false)
    expect(statSummary(withAvg(0, 'm'), 'cards35').some((i) => i.label === 'Gol ort.')).toBe(false)
  })
})

describe('yapay zekâ istemi: gol ortalaması', () => {
  it('dolu gol ortalaması satırı eskisiyle birebir aynıdır', () => {
    expect(avgLine(blockOf(withAvg(3.75, 'm')))).toBe('Gol ortalaması: 3,75')
    expect(avgLine(blockOf(withAvg(2, 'm')))).toBe('Gol ortalaması: 2')
  })

  it('0 ya da negatif gol ortalaması "veri yok" yazılır', () => {
    for (const value of [0, -1]) {
      const block = blockOf(withAvg(value, 'm'))
      expect(avgLine(block), String(value)).toBe('Gol ortalaması: veri yok')
      expect(block).not.toMatch(/Gol ortalaması: (0|-1) /)
    }
  })

  it('0 olarak gelen gol ortalaması, hiç gelmemiş gol ortalamasıyla birebir aynı bloğu verir', () => {
    expect(blockOf(withAvg(0, 'ayni'))).toBe(blockOf(withAvg(undefined, 'ayni')))
    expect(blockOf(withAvg(0, 'ayni'))).toBe(blockOf(withAvg(null, 'ayni')))
  })

  it('yalnızca gol ortalaması alanı değişir; korner, kart, puan, xG ve oranlar aynı kalır', () => {
    const rest = (block: string) => block.split('\n').find((l) => l.startsWith('İstatistik:'))!.replace(/Gol ortalaması: [^;]*;/, 'Gol ortalaması: X ;')
    const filled = withAvg(3.75, 'm', { homeXg: 1.6, awayXg: 1.1 })
    const zero = withAvg(0, 'm', { homeXg: 1.6, awayXg: 1.1 })
    expect(rest(blockOf(zero))).toBe(rest(blockOf(filled)))
    // xG doluyken gol modeli xG'den hesaplanır: gol ortalamasının 0 olması model satırını değiştirmez.
    const model = (block: string) => block.split('\n').find((l) => l.startsWith('Gol modeli:'))
    expect(model(blockOf(zero))).toBe(model(blockOf(filled)))
  })
})

describe('hesaplar değişmedi: eksik gol ortalaması eskisi gibi dışlanır, 0 olarak girmez', () => {
  it('0 gol ortalaması ile gol ortalamasız maç aynı yüzdeleri, yıldızları ve skor olasılıklarını verir', () => {
    const strip = (match: Match) => Object.values(analyzeDay([match], defaultThresholds(), 'percent')).map((a) => a.predictions.map(({ match: _, ...p }) => p))
    expect(strip(withAvg(0, 'm'))).toEqual(strip(withAvg(undefined, 'm')))
    expect(scoreForecast(withAvg(0, 'm'))).toEqual(scoreForecast(withAvg(undefined, 'm')))
    // xG de gol ortalaması da yokken model yüzdesi hiç üretilmez (0 girseydi %0 çıkardı).
    expect(goalModelPercent(withAvg(0, 'm'), 'over25')).toBeNull()
  })
})

// ───────── Kart ve korner ortalaması ─────────

const withStats = (stats: Record<string, StatValue | undefined>, id = 'm'): Match => {
  const merged: Record<string, StatValue> = { ...BASE, homeXg: 1.6, awayXg: 1.1 }
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  return makeMatch(merged, { id, home: 'Ev Takımı', away: 'Dep Takımı', time: '20:00', league: 'Testland · Deneme Ligi' })
}
const VALUE_CASES: [string, StatValue | undefined, boolean][] = [
  ['dolu', 4.2, true],
  ['çok küçük ama pozitif', 0.21, true],
  ['0', 0, false],
  ['negatif', -1.26, false],
  ['-2', -2, false],
  ['kolon yok', undefined, false],
  ['boş değer', null, false],
]
const field = (block: string, label: string): string => new RegExp(`${label}: [^;]*`).exec(block)![0].trim()

describe('usableAvgCards: gösterimdeki kural kart hesabındaki kuralla birebir aynıdır', () => {
  it.each(VALUE_CASES)('%s', (_, avgCards, usable) => {
    const match = withStats({ avgCards })
    expect(usableAvgCards(match) !== null).toBe(usable)
    // Kart listeleri: ortalama kullanılabilirse yüzde üretilir, değilse maç dışlanır.
    expect(CALCULATORS.cards35.calculate(match).ok).toBe(usable)
    expect(CALCULATORS.cards45.calculate(match).ok).toBe(usable)
  })
})

describe('usableAvgCorners: yalnızca gösterim (korner listeleri bu alanı kullanmaz)', () => {
  it.each(VALUE_CASES)('%s', (_, avgCorners, usable) => {
    expect(usableAvgCorners(withStats({ avgCorners })) !== null).toBe(usable)
  })

  it('korner ortalaması ne olursa olsun korner listelerinin yüzdesi aynıdır', () => {
    for (const id of ['corners85', 'corners95', 'corners105'] as const) {
      const results = [9.5, 0, -1, undefined].map((avgCorners) => CALCULATORS[id].calculate(withStats({ avgCorners, corners85Pct: 80, corners95Pct: 75, corners105Pct: 72 })))
      expect(new Set(results.map((r) => JSON.stringify(r))).size, id).toBe(1)
    }
  })
})

describe('admin kartı: kart ve korner ortalaması', () => {
  const item = (match: Match, categoryId: 'cards35' | 'corners85', label: string) => statSummary(match, categoryId).find((i) => i.label === label)

  it('dolu değerler eskisi gibi yazılır', () => {
    expect(statSummary(withStats({}), 'cards35')).toEqual([{ label: 'Kart ort.', value: '4,2' }])
    expect(statSummary(withStats({}), 'corners85')).toEqual([{ label: 'Korner ort.', value: '9,5' }])
    expect(item(withStats({ avgCards: 0.21 }), 'cards35', 'Kart ort.')).toEqual({ label: 'Kart ort.', value: '0,21' })
  })

  it('0 ya da negatif ortalama "veri yok" yazılır', () => {
    for (const value of [0, -0.5, -1.26, -2]) {
      expect(item(withStats({ avgCards: value }), 'cards35', 'Kart ort.'), `kart ${value}`).toEqual({ label: 'Kart ort.', value: 'veri yok' })
      expect(item(withStats({ avgCorners: value }), 'corners85', 'Korner ort.'), `korner ${value}`).toEqual({ label: 'Korner ort.', value: 'veri yok' })
    }
  })

  it('kolon hiç yoksa satır eskisi gibi hiç yazılmaz', () => {
    expect(statSummary(withStats({ avgCards: undefined }), 'cards35')).toEqual([])
    expect(statSummary(withStats({ avgCorners: null }), 'corners85')).toEqual([])
  })
})

describe('yapay zekâ istemi: kart ve korner ortalaması', () => {
  it('dolu değerlerin satırı eskisiyle birebir aynıdır', () => {
    const block = blockOf(withStats({}))
    expect(field(block, 'Korner ortalaması')).toBe('Korner ortalaması: 9,5')
    expect(field(block, 'Kart ortalaması')).toBe('Kart ortalaması: 4,2')
    expect(block.split('\n').find((l) => l.startsWith('İstatistik:'))).toBe(
      'İstatistik: Gol ortalaması: 3,75 ; Korner ortalaması: 9,5 ; Kart ortalaması: 4,2 ; Maç başı puan (PPG): ev 1,8 / deplasman 1,1 ; Maç öncesi xG: ev 1,6 / deplasman 1,1 ; 1X2 oranları: 1,5 / 4,2 / 6,5',
    )
  })

  it('0 ya da negatif ortalama "veri yok" yazılır; negatif sayı isteme girmez', () => {
    for (const value of [0, -0.5, -1.26, -2]) {
      const block = blockOf(withStats({ avgCards: value, avgCorners: value }))
      expect(field(block, 'Kart ortalaması'), String(value)).toBe('Kart ortalaması: veri yok')
      expect(field(block, 'Korner ortalaması'), String(value)).toBe('Korner ortalaması: veri yok')
      expect(block.split('\n').find((l) => l.startsWith('İstatistik:'))).not.toMatch(/ortalaması: (0|-)/)
    }
  })

  it('0 olarak gelen ortalama, hiç gelmemiş ortalamayla birebir aynı bloğu verir', () => {
    expect(blockOf(withStats({ avgCards: 0 }, 'a'))).toBe(blockOf(withStats({ avgCards: undefined }, 'a')))
    expect(blockOf(withStats({ avgCards: -1.43 }, 'a'))).toBe(blockOf(withStats({ avgCards: undefined }, 'a')))
    expect(blockOf(withStats({ avgCorners: 0 }, 'a'))).toBe(blockOf(withStats({ avgCorners: undefined }, 'a')))
  })

  it('maç başı puan (PPG) satırına dokunulmaz: 0 gerçek bir değer olabilir', () => {
    expect(field(blockOf(withStats({ homePpg: 0, awayPpg: 2.33 })), 'Maç başı puan \\(PPG\\)')).toBe('Maç başı puan (PPG): ev 0 / deplasman 2,33')
    expect(field(blockOf(withStats({ homePpg: 0, awayPpg: 0 })), 'Maç başı puan \\(PPG\\)')).toBe('Maç başı puan (PPG): ev 0 / deplasman 0')
  })

  it('yalnızca ilgili alan değişir: diğer istatistikler ve öneriler aynı kalır', () => {
    const mask = (block: string) => block.replace(/Kart ortalaması: [^;]*;/, 'Kart ortalaması: X ;').replace(/Korner ortalaması: [^;]*;/, 'Korner ortalaması: X ;')
    // Korner ortalaması hiçbir hesaba girmez: 0 olması bloğun geri kalanını değiştirmez.
    expect(mask(blockOf(withStats({ avgCorners: 0 })))).toBe(mask(blockOf(withStats({}))))
    // Kart ortalaması 0 olunca maç kart listelerinden düşer (hesabın zaten yaptığı şey); istatistik satırının geri kalanı aynıdır.
    const stats = (block: string) => mask(block).split('\n').find((l) => l.startsWith('İstatistik:'))
    expect(stats(blockOf(withStats({ avgCards: 0 })))).toBe(stats(blockOf(withStats({}))))
  })
})

describe('hesaplar değişmedi: kart ve korner ortalaması', () => {
  it('0 / negatif kart ortalaması ile kart ortalamasız maç aynı listeleri, yüzdeleri ve yıldızları verir', () => {
    const strip = (match: Match) => Object.values(analyzeDay([match], defaultThresholds(), 'percent')).map((a) => a.predictions.map(({ match: _, ...p }) => p))
    for (const value of [0, -1.26]) expect(strip(withStats({ avgCards: value })), String(value)).toEqual(strip(withStats({ avgCards: undefined })))
    expect(strip(withStats({ avgCorners: 0 }))).toEqual(strip(withStats({})))
  })
})
