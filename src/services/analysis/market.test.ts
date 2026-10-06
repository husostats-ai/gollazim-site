import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds } from '../../config/categories'
import { buildPrompts, matchBlock } from '../ai/prompt'
import { collectAiMatches } from '../ai/collect'
import { importCsv } from '../csv/importer'
import { buildPicksForResult } from '../results/freeze'
import { backfillMarket, buildMarketStats } from '../stats/marketStats'
import type { MatchResult, Pick, PickOutcome } from '../../types'
import { analyzeCategory, analyzeDay } from './engine'
import {
  DEFAULT_MARKET_CONFLICT_LIMIT,
  devig,
  hasMarket,
  isMarketConflict,
  marketInfo,
  marketNotes,
  marketPercent,
  normalizeMarketConflictLimit,
} from './market'
import { makeMatch } from './testUtils'

describe('devig (marj arındırma)', () => {
  it('iki yönlü oranı 1/o ile normalize eder', () => {
    // 1/1,80 + 1/2,00 = 1,0556 (marj %5,56); marjsız: 0,5556 / 1,0556
    expect(devig(1.8, 2.0)).toBeCloseTo(0.5263, 4)
    // Marjsız, simetrik oran: tam %50
    expect(devig(2, 2)).toBe(0.5)
    // İki tarafın marjsız olasılıkları toplamı 1'dir
    expect(devig(1.25, 3.6)! + devig(3.6, 1.25)!).toBeCloseTo(1, 10)
  })

  it('marjı sadece 1/o almaktan ayırır', () => {
    expect(1 / 1.8).toBeCloseTo(0.5556, 4)
    expect(devig(1.8, 2.0)).toBeLessThan(1 / 1.8)
  })

  it('oranlardan biri yoksa ya da geçersizse sonuç yoktur', () => {
    expect(devig(null, 2)).toBeNull()
    expect(devig(1.8, null)).toBeNull()
    expect(devig(0, 2)).toBeNull()
    expect(devig(1, 2)).toBeNull()
    expect(devig(-1.5, 2)).toBeNull()
    expect(devig(NaN, 2)).toBeNull()
  })
})

describe('marketPercent', () => {
  it('her kategori kendi oran kolonlarını kullanır', () => {
    const match = makeMatch({
      oddsOver25: 1.6,
      oddsUnder25: 2.3,
      Odds_Over35: 2.5,
      Odds_Under35: 1.5,
      Odds_Over45: 4,
      Odds_Under45: 1.2,
      Odds_BTTS_Yes: 1.7,
      Odds_BTTS_No: 2.05,
      Odds_1st_Half_Over05: 1.3,
      Odds_1st_Half_Under05: 3.4,
      Odds_1st_Half_Over15: 2.4,
      Odds_1st_Half_Under15: 1.55,
      Odds_2nd_Half_Over05: 1.2,
      Odds_2nd_Half_Under05: 4.3,
      Odds_Corners_Over85: 1.5,
      Odds_Corners_Under85: 2.5,
      Odds_Corners_Over95: 1.9,
      Odds_Corners_Under95: 1.9,
      Odds_Corners_Over105: 2.6,
      Odds_Corners_Under105: 1.45,
    })
    const percents = Object.fromEntries(CATEGORIES.filter((c) => hasMarket(c.id)).map((c) => [c.id, marketPercent(match, c.id)]))
    expect(percents).toEqual({
      over25: 59,
      ht05: 72,
      btts: 55,
      sh05: 78,
      over35: 38,
      over45: 23,
      ht15: 39,
      corners85: 63,
      corners95: 50,
      corners105: 36,
    })
  })

  it('eski yüklemelerde ham kolon adıyla saklanan 2.5 oranını da okur', () => {
    expect(marketPercent(makeMatch({ Odds_Over25: 1.6, Odds_Under25: 2.3 }), 'over25')).toBe(59)
  })

  it('iki orandan biri eksikse piyasa yüzdesi yoktur (tek orandan tahmin edilmez)', () => {
    expect(marketPercent(makeMatch({ Odds_BTTS_Yes: 1.7 }), 'btts')).toBeNull()
    expect(marketPercent(makeMatch({ Odds_BTTS_Yes: 1.7, Odds_BTTS_No: null }), 'btts')).toBeNull()
    expect(marketPercent(makeMatch({ Odds_BTTS_Yes: 1.7, Odds_BTTS_No: 0 }), 'btts')).toBeNull()
    expect(marketPercent(makeMatch({ Odds_BTTS_Yes: 'N/A', Odds_BTTS_No: 2 }), 'btts')).toBeNull()
    expect(marketPercent(makeMatch({}), 'corners95')).toBeNull()
  })

  it('kapsam dışı kategorilerde (kart, Taraf & Gol, 2.5 Üst & KG Var) hiç hesaplanmaz', () => {
    const match = makeMatch({ oddsOver25: 1.6, oddsUnder25: 2.3, Odds_BTTS_Yes: 1.7, Odds_BTTS_No: 2.05 })
    for (const id of ['cards35', 'cards45', 'homeWin15', 'homeWin25', 'awayWin15', 'awayWin25', 'over25btts'] as const) {
      expect(hasMarket(id)).toBe(false)
      expect(marketPercent(match, id)).toBeNull()
      expect(marketInfo(match, id, 80, 25)).toBeUndefined()
    }
  })

  it('gerçek CSV biçiminden (N/A, virgüllü ondalık) okur', () => {
    const csv = [
      'date_unix,Home Team,Away Team,BTTS Average,Odds_BTTS_Yes,Odds_BTTS_No,Odds_1st_Half_Over05,Odds_1st_Half_Under05',
      '1791190800,A,B,90,"1,7","2,05",N/A,"3,4"',
    ].join('\n')
    const [match] = importCsv(csv, 'u').matches
    expect(marketPercent(match, 'btts')).toBe(55)
    expect(marketPercent(match, 'ht05')).toBeNull()
  })
})

describe('piyasa çelişkisi', () => {
  it('varsayılan sınır 25 puandır ve sınırın kendisi çelişki sayılır', () => {
    expect(DEFAULT_MARKET_CONFLICT_LIMIT).toBe(25)
    expect(isMarketConflict(80, 56, 25)).toBe(false) // fark 24
    expect(isMarketConflict(80, 55, 25)).toBe(true) // fark 25
    expect(isMarketConflict(50, 80, 25)).toBe(true) // piyasa daha yüksekse de
    expect(isMarketConflict(80, 55, 26)).toBe(false)
  })

  it('oran yoksa çelişki değil, "Oran yok" etiketi çıkar', () => {
    const info = marketInfo(makeMatch({}), 'btts', 95, 25)
    expect(info).toEqual({ percent: null, conflict: false })
    expect(marketNotes(95, info, 25).map((n) => [n.kind, n.label])).toEqual([['no-odds', 'Oran yok']])
  })

  it('rozetler: çelişki varsa "Piyasa çelişkisi", yoksa hiçbiri', () => {
    const match = makeMatch({ Odds_BTTS_Yes: 1.7, Odds_BTTS_No: 2.05 }) // piyasa %55
    expect(marketNotes(80, marketInfo(match, 'btts', 80, 25), 25).map((n) => n.label)).toEqual(['Piyasa çelişkisi'])
    expect(marketNotes(79, marketInfo(match, 'btts', 79, 25), 25)).toEqual([])
    expect(marketNotes(79, marketInfo(match, 'btts', 79, 20), 20).map((n) => n.kind)).toEqual(['market-conflict'])
    expect(marketNotes(80, undefined, 25)).toEqual([])
  })

  it('ayardaki sınır geçersizse varsayılana döner', () => {
    expect(normalizeMarketConflictLimit(30)).toBe(30)
    expect(normalizeMarketConflictLimit(undefined)).toBe(25)
    expect(normalizeMarketConflictLimit(0)).toBe(25)
    expect(normalizeMarketConflictLimit(12.5)).toBe(25)
    expect(normalizeMarketConflictLimit('30')).toBe(25)
  })
})

describe('analiz: piyasa yalnızca gösterimdir', () => {
  const stats = { over25Pct: 90, bttsPct: 85, ht05Pct: 88, sh05Pct: 80, corners95Pct: 75, avgCards: 5, homeXg: 1.4, awayXg: 1.3 }
  const odds = { oddsOver25: 2.4, oddsUnder25: 1.5, Odds_BTTS_Yes: 2.6, Odds_BTTS_No: 1.45, Odds_1st_Half_Over05: 1.3, Odds_1st_Half_Under05: 3.4 }
  const plain = [makeMatch(stats, { id: 'a' }), makeMatch({ ...stats, over25Pct: 80 }, { id: 'b', time: '18:00' })]
  const priced = [makeMatch({ ...stats, ...odds }, { id: 'a' }), makeMatch({ ...stats, over25Pct: 80, ...odds }, { id: 'b', time: '18:00' })]
  const core = (matches: typeof plain, sortMode: 'percent' | 'cautious', limit?: number) =>
    Object.values(analyzeDay(matches, defaultThresholds(), sortMode, limit)).map((a) => ({
      id: a.categoryId,
      qualified: a.qualifiedCount,
      rows: a.predictions.map((p) => [p.match.id, p.percent, p.stars, p.cautiousPercent, p.reliability.level, p.secondPercent, p.conflict, p.notes]),
    }))

  it('oran olsa da olmasa da, sınır ne olursa olsun yüzde, yıldız, sıra ve temkinli sıra aynıdır', () => {
    for (const mode of ['percent', 'cautious'] as const) {
      expect(core(priced, mode)).toEqual(core(plain, mode))
      expect(core(priced, mode, 5)).toEqual(core(plain, mode))
      expect(core(priced, mode, 100)).toEqual(core(plain, mode))
    }
  })

  it('öneriye piyasa bilgisini ekler', () => {
    const [first] = analyzeCategory(priced, 'over25', 75).predictions
    expect(first.percent).toBe(90)
    expect(first.market).toEqual({ percent: 38, conflict: true })
    expect(analyzeCategory(plain, 'over25', 75).predictions[0].market).toEqual({ percent: null, conflict: false })
    expect(analyzeCategory(priced, 'cards35', 0).predictions[0].market).toBeUndefined()
  })

  it('sınır değişince yalnızca çelişki bilgisi değişir', () => {
    // KG Var hazır %85, piyasa %36: fark 49
    expect(analyzeCategory(priced, 'btts', 80, 'percent', 49).predictions[0].market).toEqual({ percent: 36, conflict: true })
    expect(analyzeCategory(priced, 'btts', 80, 'percent', 50).predictions[0].market).toEqual({ percent: 36, conflict: false })
  })
})

const NOW = '2026-10-05T21:00:00Z'
const completed: MatchResult = {
  matchId: 'x',
  status: 'completed',
  htHome: 1,
  htAway: 0,
  ftHome: 2,
  ftAway: 1,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: NOW,
}

describe('dondurma: piyasa bilgisi kaydedilir', () => {
  // 2.5 Üst %90 (piyasa %38: çelişki), KG Var %85 (oran yok), İY 0.5 %88 (piyasa %72: çelişki yok), korner 9.5 %75 (oran yok), kart 3.5
  const match = makeMatch({
    over25Pct: 90,
    bttsPct: 85,
    ht05Pct: 88,
    corners95Pct: 75,
    avgCards: 6,
    oddsOver25: 2.4,
    oddsUnder25: 1.5,
    Odds_1st_Half_Over05: 1.3,
    Odds_1st_Half_Under05: 3.4,
    Odds_BTTS_Yes: 1.7,
  })
  const freeze = (limit?: number) =>
    buildPicksForResult({ match, dayMatches: [match], thresholds: defaultThresholds(), result: completed, existing: [], now: NOW, marketConflictLimit: limit })
  const byCategory = (picks: Pick[]) => Object.fromEntries(picks.map((p) => [p.categoryId, p]))

  it('piyasa yüzdesi ve çelişki durumu yazılır; oran yoksa null ya da 0 değil "none"', () => {
    const picks = byCategory(freeze())
    expect(picks.over25).toMatchObject({ percent: 90, marketPercent: 38, marketConflict: true })
    expect(picks.ht05).toMatchObject({ percent: 88, marketPercent: 72, marketConflict: false })
    expect(picks.btts).toMatchObject({ percent: 85, marketPercent: 'none', marketConflict: 'none' })
    expect(picks.corners95).toMatchObject({ marketPercent: 'none', marketConflict: 'none', outcome: 'void' })
  })

  it('kapsam dışı kategorilerde piyasa alanı hiç yoktur', () => {
    const cards = byCategory(freeze()).cards35
    expect(cards).toBeDefined()
    expect('marketPercent' in cards).toBe(false)
    expect('marketConflict' in cards).toBe(false)
  })

  it('çelişki, dondurma anındaki sınıra göre kaydedilir', () => {
    expect(byCategory(freeze(60)).over25).toMatchObject({ marketPercent: 38, marketConflict: false })
    expect(byCategory(freeze(16)).ht05).toMatchObject({ marketPercent: 72, marketConflict: true })
  })

  it('skor düzeltilince kayıtlı piyasa bilgisi değişmez, yalnızca sonuç yeniden hesaplanır', () => {
    const existing = freeze()
    const changedOdds = { ...match, stats: { ...match.stats, oddsOver25: 1.2, oddsUnder25: 4.5 } }
    const again = buildPicksForResult({
      match: changedOdds,
      dayMatches: [changedOdds],
      thresholds: defaultThresholds(),
      result: { ...completed, ftHome: 3 },
      existing,
      now: NOW,
      marketConflictLimit: 5,
    })
    expect(byCategory(again).over25).toMatchObject({ marketPercent: 38, marketConflict: true, outcome: 'won' })
  })
})

describe('kalibrasyon: geriye dönük hesap ve tablo', () => {
  let n = 0
  const pick = (categoryId: Pick['categoryId'], outcome: PickOutcome, percent: number, extra: Partial<Pick> = {}): Pick => ({
    id: `p${++n}`,
    matchId: `m${n}`,
    categoryId,
    date: '2026-10-05',
    percent,
    threshold: 75,
    outcome,
    frozenAt: NOW,
    ...extra,
  })

  it('piyasa bilgisi olmayan eski öneriyi maç kaydındaki oranlardan tamamlar', () => {
    const match = makeMatch({ Odds_BTTS_Yes: 1.7, Odds_BTTS_No: 2.05, oddsOver25: 1.6 }, { id: 'old' })
    const picks = [
      pick('btts', 'won', 85, { matchId: 'old' }), // piyasa %55, fark 30
      pick('over25', 'lost', 80, { matchId: 'old' }), // 2.5 Alt oranı yok
      pick('btts', 'won', 85, { matchId: 'silinmis' }), // maç kaydı yok
      pick('cards35', 'won', 80, { matchId: 'old' }), // kapsam dışı
      pick('btts', 'lost', 90, { matchId: 'old', marketPercent: 70, marketConflict: false }), // kayıtlı değer korunur
    ]
    const result = backfillMarket(picks, [match], 25)
    expect(result.backfilled).toBe(2)
    expect(result.unknown).toBe(1)
    expect(result.picks[0]).toMatchObject({ marketPercent: 55, marketConflict: true })
    expect(result.picks[1]).toMatchObject({ marketPercent: 'none', marketConflict: 'none' })
    expect(result.picks[2].marketPercent).toBeUndefined()
    expect(result.picks[3].marketPercent).toBeUndefined()
    expect(result.picks[4]).toMatchObject({ marketPercent: 70, marketConflict: false })
    // Girdi değişmez
    expect(picks[0].marketPercent).toBeUndefined()
    // Sınır 31 olsaydı aynı öneri çelişkisiz sayılırdı
    expect(backfillMarket(picks, [match], 31).picks[0]).toMatchObject({ marketPercent: 55, marketConflict: false })
  })

  it('kategori bazında hazır ort., piyasa ort., gerçekleşen ve çelişkili / çelişkisiz başarıyı verir', () => {
    const priced = (outcome: PickOutcome, percent: number, market: number, conflict: boolean) =>
      pick('btts', outcome, percent, { marketPercent: market, marketConflict: conflict })
    const picks = [
      priced('won', 90, 60, true),
      priced('lost', 90, 50, true),
      priced('lost', 80, 40, true),
      priced('won', 80, 70, false),
      priced('void', 100, 10, true), // değerlendirilemedi: ortalamaya ve orana girmez
      pick('btts', 'won', 95, { marketPercent: 'none', marketConflict: 'none' }),
      pick('btts', 'won', 95), // maç silinmiş: bilinmiyor
      pick('corners95', 'void', 80, { marketPercent: 45, marketConflict: true }),
      pick('cards35', 'won', 80),
    ]
    const stats = buildMarketStats({ picks, backfilled: 0, unknown: 1 })!
    expect(stats.rows.map((r) => r.key)).toEqual(['btts', 'corners95', 'all'])
    const btts = stats.rows[0]
    expect(btts).toMatchObject({ ready: 85, market: 55, noOdds: 1 })
    expect(btts.tally).toMatchObject({ won: 2, decided: 4, void: 1, rate: 50, lowSample: true })
    expect(btts.conflict).toMatchObject({ won: 1, decided: 3, rate: 33.3 })
    expect(btts.clear).toMatchObject({ won: 1, decided: 1, rate: 100 })
    // Korner sonucu girilmemiş öneri değerlendirilemedi kalır: ortalama ve oran boş
    expect(stats.rows[1]).toMatchObject({ ready: null, market: null })
    expect(stats.rows[1].tally).toMatchObject({ decided: 0, void: 1, rate: null })
    expect(stats.rows[2].tally).toMatchObject({ decided: 4, void: 2 })
    expect(stats.unknown).toBe(1)
  })

  it('kapsamda öneri yoksa kart gösterilmez', () => {
    expect(buildMarketStats({ picks: [pick('cards35', 'won', 80), pick('btts', 'won', 80)], backfilled: 0, unknown: 1 })).toBeNull()
  })
})

describe('AI prompt: piyasa satırı', () => {
  const priced = makeMatch({ over25Pct: 90, bttsPct: 85, oddsOver25: 2.4, oddsUnder25: 1.5, Odds_BTTS_Yes: 1.7, Odds_BTTS_No: 2.05, Odds_Corners_Over95: 1.9 })
  const bare = makeMatch({ over25Pct: 90 })
  const items = collectAiMatches(analyzeDay([priced, bare], defaultThresholds()))

  it('oranı olan kategorileri tek satırda yazar; oran yoksa satır hiç eklenmez', () => {
    const block = matchBlock(items.find((i) => i.match.id === priced.id)!, 1)
    expect(block.split('\n')[4]).toBe('Piyasa: 2.5 ÜST %38 ; KG VAR %55')
    expect(block).toContain('2.5 ÜST %90 (güvenilirlik: Bilinmiyor; Piyasa çelişkisi)')
    // KG Var hazır %85, piyasa %55: fark 30
    expect(block).toContain('KG VAR %85 (güvenilirlik: Bilinmiyor; Piyasa çelişkisi)')
    const plain = matchBlock(items.find((i) => i.match.id === bare.id)!, 2)
    expect(plain.split('\n')).toHaveLength(4)
    expect(plain).not.toContain('Piyasa')
  })

  it('cevap biçimi değişmez', () => {
    const [chunk] = buildPrompts(items, 'chatgpt', '5 Ekim 2026 Pazartesi')
    expect(chunk.text).toContain('- Her maç için tek satır yaz: #numara | KARAR | gerekçe | risk')
    expect(chunk.text).toContain('"Piyasa" satırı')
  })
})
