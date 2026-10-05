import { describe, expect, it } from 'vitest'
import { poissonAtLeast } from '../poisson'
import { makeMatch } from '../testUtils'
import { removeMargin, splitGoals, totalGoalsFromOver25 } from './calibrate'
import { outcomeProbs, scoreProbability, sideWinsAndGoals } from './scoreModel'
import { buildSideGoalsModel, evaluateSideGoals } from './sideGoals'

const HOME_15 = { side: 'home', minGoals: 2 } as const
const HOME_25 = { side: 'home', minGoals: 3 } as const
const AWAY_15 = { side: 'away', minGoals: 2 } as const
const AWAY_25 = { side: 'away', minGoals: 3 } as const

describe('skor modeli', () => {
  it('sonuç olasılıkları 1 eder; taraflar simetriktir', () => {
    const p = outcomeProbs(1.7, 1.1)
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6)
    expect(p.home).toBeGreaterThan(p.away)
    const q = outcomeProbs(1.1, 1.7)
    expect(q.away).toBeCloseTo(p.home, 9)
    expect(sideWinsAndGoals(1.1, 1.7, 'away', 3)).toBeCloseTo(sideWinsAndGoals(1.7, 1.1, 'home', 3), 9)
  })

  it('ortak olasılık skor tablosundan gelir: ev kazanır & 1.5 Üst = ev kazanır - P(1-0)', () => {
    const [h, a] = [1.6, 1.2]
    const homeWin = outcomeProbs(h, a).home
    const oneNil = scoreProbability(h, a, (i, j) => i === 1 && j === 0)
    expect(sideWinsAndGoals(h, a, 'home', 2)).toBeCloseTo(homeWin - oneNil, 9)
    // 2.5 Üst için 1-0 ve 2-0 düşer
    const twoNil = scoreProbability(h, a, (i, j) => i === 2 && j === 0)
    expect(sideWinsAndGoals(h, a, 'home', 3)).toBeCloseTo(homeWin - oneNil - twoNil, 9)
  })

  it('marjinal yüzdelerin çarpımından farklıdır', () => {
    const [h, a] = [2.2, 0.8]
    const joint = sideWinsAndGoals(h, a, 'home', 3)
    const product = outcomeProbs(h, a).home * poissonAtLeast(3, h + a)
    expect(Math.abs(joint - product)).toBeGreaterThan(0.03)
  })
})

describe('kalibrasyon', () => {
  it('bahisçi marjını çıkarır', () => {
    const p = removeMargin([2.0, 3.5, 4.0])
    expect(p.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9)
    expect(p[0]).toBeCloseTo(0.5 / (0.5 + 1 / 3.5 + 0.25), 9)
    expect(removeMargin([1.9, 1.9])).toEqual([0.5, 0.5])
  })

  it('toplam gol beklentisi 2.5 Üst olasılığını geri verir', () => {
    for (const p of [0.3, 0.5, 0.65, 0.8]) expect(poissonAtLeast(3, totalGoalsFromOver25(p))).toBeCloseTo(p, 6)
  })

  it('gol beklentisini piyasadaki galibiyet olasılıklarına göre böler', () => {
    // Bilinen bir modelden üretilen olasılıklar geri bulunmalı
    const truth = { home: 1.9, away: 0.9 }
    const split = splitGoals(truth.home + truth.away, outcomeProbs(truth.home, truth.away))
    expect(split.home).toBeCloseTo(truth.home, 2)
    expect(split.away).toBeCloseTo(truth.away, 2)
    expect(split.home + split.away).toBeCloseTo(2.8, 9)
  })
})

describe('buildSideGoalsModel', () => {
  const odds = { oddsHome: 1.8, oddsDraw: 3.8, oddsAway: 4.5 }
  const overUnder = { oddsOver25: 1.7, oddsUnder25: 2.15 }
  const xg = { homeXg: 1.2, awayXg: 1.6 }

  it('1X2 + Alt/Üst oranı varsa piyasaya kalibre eder', () => {
    const model = buildSideGoalsModel(makeMatch({ ...odds, ...overUnder, ...xg }))!
    expect(model.source).toBe('market')
    const [pOver] = removeMargin([1.7, 2.15])
    expect(poissonAtLeast(3, model.main.home + model.main.away)).toBeCloseTo(pOver, 5)
    const fitted = outcomeProbs(model.main.home, model.main.away)
    expect(fitted.home).toBeCloseTo(model.market!.home, 1)
    expect(model.second).toEqual({ home: 1.2, away: 1.6 })
  })

  it('Alt/Üst oranı yoksa toplamı xG ve gol ortalamasından tahmin eder', () => {
    const model = buildSideGoalsModel(makeMatch({ ...odds, ...xg, avgGoals: 3.2 }))!
    expect(model.source).toBe('market-side')
    expect(model.main.home + model.main.away).toBeCloseTo((2.8 + 3.2) / 2, 9)
    expect(model.main.home).toBeGreaterThan(model.main.away) // taraf 1X2'den: ev favori
    // tek taraflı Alt/Üst oranı marjı çıkarılamadığı için kullanılmaz
    expect(buildSideGoalsModel(makeMatch({ ...odds, ...xg, oddsOver25: 1.7 }))!.source).toBe('market-side')
  })

  it('1X2 oranı yoksa yalnızca xG kullanır; ikinci hesap üretilmez', () => {
    const model = buildSideGoalsModel(makeMatch({ ...xg, ...overUnder, oddsHome: null }))!
    expect(model).toMatchObject({ source: 'xg', main: { home: 1.2, away: 1.6 }, second: null, market: null })
  })

  it('hiçbir kaynak yoksa null döner; uydurma değer üretmez', () => {
    expect(buildSideGoalsModel(makeMatch({}))).toBeNull()
    expect(buildSideGoalsModel(makeMatch({ homeXg: 0, awayXg: 0 }))).toBeNull()
    // 1X2 var ama toplam gol için hiçbir veri yok
    expect(buildSideGoalsModel(makeMatch(odds))).toBeNull()
    // geçersiz oran (1 veya altı) yok sayılır
    expect(buildSideGoalsModel(makeMatch({ ...odds, oddsDraw: 1, avgGoals: 2.5 }))).toBeNull()
  })

  it('kolon eşlemesinden önce yüklenmiş maçlarda oranı CSV kolon adından okur', () => {
    const legacy = makeMatch({ Odds_Home_Win: 1.8, Odds_Draw: 3.8, Odds_Away_Win: 4.5, Odds_Over25: 1.7, Odds_Under25: 2.15 })
    expect(buildSideGoalsModel(legacy)!.source).toBe('market')
  })
})

describe('evaluateSideGoals', () => {
  it('dört liste tutarlıdır: 2.5 Üst her zaman 1.5 Üst’ten küçük, favori taraf büyük', () => {
    const model = buildSideGoalsModel(
      makeMatch({ oddsHome: 1.5, oddsDraw: 4.4, oddsAway: 6.5, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 2.1, awayXg: 0.9 }),
    )!
    const [h15, h25, a15, a25] = [HOME_15, HOME_25, AWAY_15, AWAY_25].map((l) => evaluateSideGoals(model, l).percent)
    expect(h25).toBeLessThan(h15)
    expect(a25).toBeLessThan(a15)
    expect(h15).toBeGreaterThan(a15)
    expect(h15 + a15).toBeLessThan(100)
  })

  it('iki hesap arasında 15 puandan fazla fark çelişkidir; tam 15 değildir', () => {
    // Piyasa evi net favori görüyor, xG deplasmanı
    const clash = buildSideGoalsModel(
      makeMatch({ oddsHome: 1.4, oddsDraw: 5, oddsAway: 8, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 0.8, awayXg: 1.9 }),
    )!
    const r = evaluateSideGoals(clash, HOME_15)
    expect(r.percent - r.secondPercent!).toBeGreaterThan(15)
    expect(r.conflict).toBe(true)

    const base = { source: 'market', market: null } as const
    const at = (second: number) =>
      evaluateSideGoals({ ...base, main: { home: 1.5, away: 1.5 }, second: { home: second, away: 1.5 } }, HOME_15)
    const same = at(1.5)
    expect(same).toMatchObject({ conflict: false, secondPercent: same.percent })
  })

  it('ikinci hesap yoksa çelişki aranmaz', () => {
    const model = buildSideGoalsModel(makeMatch({ homeXg: 1.4, awayXg: 1.1 }))!
    expect(evaluateSideGoals(model, HOME_15)).toMatchObject({ source: 'xg', secondPercent: null, conflict: false })
  })
})
