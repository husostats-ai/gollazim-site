import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Pick, PickOutcome } from '../../types'
import { toAppDateTime } from '../../utils/date'
import type { ReliabilityLevel } from '../analysis/types'
import { monthKey, weekStart } from './periods'
import { buildStats, LOW_SAMPLE_LIMIT, tally } from './statsEngine'

let n = 0
const pick = (
  outcome: PickOutcome,
  over: { date?: string; categoryId?: CategoryId; reliability?: ReliabilityLevel; conflict?: boolean; percent?: number } = {},
): Pick => ({
  id: `p${++n}`,
  matchId: `m${n}`,
  categoryId: over.categoryId ?? 'over25',
  date: over.date ?? '2026-10-05',
  percent: over.percent ?? 80,
  threshold: 75,
  outcome,
  frozenAt: '2026-10-05T21:00:00Z',
  reliability: over.reliability,
  ...(over.conflict !== undefined && { conflict: over.conflict }),
})
const many = (count: number, outcome: PickOutcome, over: Parameters<typeof pick>[1] = {}) =>
  Array.from({ length: count }, () => pick(outcome, over))

describe('tally', () => {
  it('başarı oranını sadece kazandı + kaybetti üzerinden hesaplar', () => {
    const t = tally([...many(193, 'won'), ...many(57, 'lost')])
    expect(t).toMatchObject({ won: 193, lost: 57, decided: 250, total: 250, rate: 77.2, lowSample: false })
  })

  it('değerlendirilemedi ve bekliyor oranı etkilemez ama ayrı sayılır', () => {
    const base = [...many(3, 'won'), ...many(1, 'lost')]
    const withExtras = [...base, ...many(5, 'void'), ...many(7, 'pending')]
    expect(tally(withExtras).rate).toBe(tally(base).rate)
    expect(tally(withExtras)).toMatchObject({ rate: 75, decided: 4, void: 5, pending: 7, total: 16 })
  })

  it('sonuçlanmış öneri yoksa oran 0 değil, boş (null) olur', () => {
    expect(tally([])).toMatchObject({ rate: null, decided: 0, total: 0, lowSample: true })
    expect(tally([...many(2, 'void'), ...many(3, 'pending')])).toMatchObject({ rate: null, decided: 0, total: 5 })
  })

  it('oranı bir ondalığa yuvarlar', () => {
    expect(tally([...many(2, 'won'), ...many(1, 'lost')]).rate).toBe(66.7)
    expect(tally([...many(58, 'won'), ...many(12, 'lost')]).rate).toBe(82.9)
    expect(tally(many(4, 'won')).rate).toBe(100)
    expect(tally(many(4, 'lost')).rate).toBe(0)
  })

  it('az veri sınırı: 19 sonuçlanmış öneri az veri, 20 değil; sınır sonuçlanmış öneriye bakar', () => {
    expect(LOW_SAMPLE_LIMIT).toBe(20)
    expect(tally(many(19, 'won')).lowSample).toBe(true)
    expect(tally(many(20, 'won')).lowSample).toBe(false)
    expect(tally([...many(19, 'won'), ...many(30, 'void')]).lowSample).toBe(true)
  })
})

describe('dönemler', () => {
  it('hafta pazartesi başlar, pazar aynı haftanın son günüdür', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // pazartesi
    expect(weekStart('2026-10-07')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // pazar
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // sonraki pazartesi
  })

  it('yıl ve ay sınırını aşan hafta tek hafta sayılır', () => {
    expect(weekStart('2026-12-31')).toBe('2026-12-28')
    expect(weekStart('2027-01-03')).toBe('2026-12-28')
    expect(weekStart('2027-01-04')).toBe('2027-01-04')
    expect(monthKey('2026-12-31')).toBe('2026-12')
    expect(monthKey('2027-01-01')).toBe('2027-01')
  })

  it('Türkiye saatiyle gece yarısını geçen maç ertesi günün, haftanın ve ayın istatistiğine girer', () => {
    // 29 Kasım Pazar 21:30 GMT = 30 Kasım Pazartesi 00:30 Türkiye: yeni haftaya girer
    const { date } = toAppDateTime(new Date('2026-11-29T21:30:00Z'))
    expect(date).toBe('2026-11-30')
    expect(weekStart(date)).toBe('2026-11-30')
    // 30 Kasım 21:30 GMT = 1 Aralık 00:30 Türkiye: yeni aya girer, hafta aynı kalır
    const late = toAppDateTime(new Date('2026-11-30T21:30:00Z')).date
    expect(late).toBe('2026-12-01')
    expect(monthKey(late)).toBe('2026-12')
    expect(weekStart(late)).toBe('2026-11-30')
  })
})

describe('buildStats', () => {
  const picks = [
    ...many(3, 'won', { date: '2026-10-05', categoryId: 'over25', reliability: 'high' }),
    ...many(1, 'lost', { date: '2026-10-05', categoryId: 'btts', reliability: 'low' }),
    ...many(1, 'won', { date: '2026-10-11', categoryId: 'btts', reliability: 'low' }), // aynı hafta (pazar)
    ...many(2, 'lost', { date: '2026-10-12', categoryId: 'over25', reliability: 'low' }), // sonraki hafta
    ...many(1, 'void', { date: '2026-10-12', categoryId: 'corners85', reliability: 'unmeasured' }),
    ...many(1, 'pending', { date: '2026-11-02', categoryId: 'ht05', reliability: 'medium' }),
    ...many(1, 'won', { date: '2026-11-02', categoryId: 'ht05' }), // güvenilirliği kayıtlı olmayan eski öneri
  ]
  const stats = buildStats(picks)
  const rows = (buckets: { key: string; tally: { won: number; lost: number; rate: number | null } }[]) =>
    buckets.map((b) => [b.key, b.tally.won, b.tally.lost, b.tally.rate])

  it('genel toplam', () => {
    expect(stats.overall).toMatchObject({ won: 5, lost: 3, void: 1, pending: 1, decided: 8, total: 10, rate: 62.5 })
  })

  it('kategori bazında, kayıt defteri sırasıyla ve sadece önerisi olanlar', () => {
    expect(rows(stats.byCategory)).toEqual([
      ['over25', 3, 2, 60],
      ['ht05', 1, 0, 100],
      ['btts', 1, 1, 50],
      ['corners85', 0, 0, null],
    ])
  })

  it('günlük, haftalık ve aylık, eskiden yeniye', () => {
    expect(rows(stats.daily)).toEqual([
      ['2026-10-05', 3, 1, 75],
      ['2026-10-11', 1, 0, 100],
      ['2026-10-12', 0, 2, 0],
      ['2026-11-02', 1, 0, 100],
    ])
    expect(rows(stats.weekly)).toEqual([
      ['2026-10-05', 4, 1, 80],
      ['2026-10-12', 0, 2, 0],
      ['2026-11-02', 1, 0, 100],
    ])
    expect(rows(stats.monthly)).toEqual([
      ['2026-10', 4, 3, 57.1],
      ['2026-11', 1, 0, 100],
    ])
  })

  it('güvenilirlik seviyesine göre: yüksek, orta, düşük, ölçülemedi, bilinmiyor sırasıyla', () => {
    expect(rows(stats.byReliability)).toEqual([
      ['high', 3, 0, 100],
      ['medium', 0, 0, null],
      ['low', 1, 3, 25],
      ['unmeasured', 0, 0, null],
      ['unknown', 1, 0, 100],
    ])
  })

  it('dönem toplamları genel toplama eşittir', () => {
    for (const buckets of [stats.daily, stats.weekly, stats.monthly, stats.byCategory, stats.byReliability]) {
      expect(buckets.reduce((s, b) => s + b.tally.total, 0)).toBe(stats.overall.total)
      expect(buckets.reduce((s, b) => s + b.tally.won, 0)).toBe(stats.overall.won)
    }
  })

  it('benzersiz maç sayısı: aynı maçın birden çok kategorideki önerileri tek maç sayılır', () => {
    const a = { ...pick('won'), matchId: 'A' }
    const list = [
      a,
      { ...pick('lost', { categoryId: 'btts' }), matchId: 'A' },
      { ...pick('void', { categoryId: 'corners85' }), matchId: 'A' },
      { ...pick('won'), matchId: 'B' },
      { ...pick('void', { categoryId: 'cards35' }), matchId: 'C' }, // sonuçlanmış önerisi yok
      { ...pick('pending'), matchId: 'D' },
    ]
    const s = buildStats(list)
    expect(s.overall).toMatchObject({ total: 6, decided: 3 })
    expect(s.matches).toEqual({ total: 4, decided: 2 })
  })

  it('Taraf & Gol grubunda öneri yoksa özel döküm üretilmez', () => {
    expect(stats.sideGoals).toBeNull()
  })

  it('hiç öneri yokken boş istatistik döner', () => {
    expect(buildStats([])).toMatchObject({ overall: { rate: null, total: 0 }, byCategory: [], daily: [] })
  })
})

describe('Taraf & Gol istatistikleri', () => {
  const side = [
    // Ev & 1.5: tahminler 60, 70 (ort. 65), 1 kazandı 1 kaybetti
    pick('won', { categoryId: 'homeWin15', percent: 60, conflict: false }),
    pick('lost', { categoryId: 'homeWin15', percent: 70, conflict: true }),
    // sonuçlanmamış öneriler ortalama tahmine girmez
    pick('pending', { categoryId: 'homeWin15', percent: 99, conflict: false }),
    pick('void', { categoryId: 'homeWin15', percent: 99, conflict: true }),
    // Dep & 2.5: tahminler 45, 50, 52 (ort. 49), 3 kazandı
    pick('won', { categoryId: 'awayWin25', percent: 45, conflict: true }),
    pick('won', { categoryId: 'awayWin25', percent: 50, conflict: false }),
    pick('won', { categoryId: 'awayWin25', percent: 52, conflict: false }),
  ]
  // Başka gruptan öneriler bu dökümü etkilememeli
  const s = buildStats([...side, ...many(5, 'lost', { categoryId: 'over25', percent: 90 })]).sideGoals!

  it('çelişkili ve çelişkisiz önerilerin başarısını ayırır', () => {
    expect(s.byConflict.map((b) => [b.key, b.tally.won, b.tally.lost, b.tally.rate, b.tally.total])).toEqual([
      ['clear', 3, 0, 100, 4],
      ['conflict', 1, 1, 50, 3],
    ])
  })

  it('kalibrasyon: ortalama tahmin ile gerçekleşen başarı, liste liste ve toplamda', () => {
    expect(s.calibration.map((r) => [r.key, r.predicted, r.tally.rate, r.tally.decided])).toEqual([
      ['homeWin15', 65, 50, 2],
      ['awayWin25', 49, 100, 3],
      ['all', 55.4, 80, 5],
    ])
    expect(s.calibration.every((r) => r.tally.lowSample)).toBe(true)
  })

  it('sonuçlanmış öneri yoksa ortalama tahmin boş kalır', () => {
    const only = buildStats([pick('pending', { categoryId: 'homeWin25', percent: 50 })]).sideGoals!
    expect(only.calibration.map((r) => [r.key, r.predicted, r.tally.rate])).toEqual([
      ['homeWin25', null, null],
      ['all', null, null],
    ])
  })
})
