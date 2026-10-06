import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { MatchResult, Pick, PickOutcome } from '../../types'
import { buildDailySummary, countUnsettledMatches, DAILY_CATEGORY_IDS, latestDecidedDate, wholePercent } from './dailySummary'
import { buildStats, tally } from './statsEngine'

const DAY = '2026-10-05'
let n = 0
const pick = (outcome: PickOutcome, categoryId: CategoryId = 'over25', date = DAY, matchId?: string): Pick => ({
  id: `p${++n}`,
  matchId: matchId ?? `m${n}`,
  categoryId,
  date,
  percent: 80,
  threshold: 75,
  outcome,
  frozenAt: '2026-10-05T21:00:00Z',
})
const many = (count: number, outcome: PickOutcome, categoryId: CategoryId = 'over25', date = DAY) =>
  Array.from({ length: count }, () => pick(outcome, categoryId, date))
const row = (picks: Pick[], categoryId: CategoryId, date = DAY) =>
  buildDailySummary(picks, date).rows.find((r) => r.categoryId === categoryId)!.tally

describe('buildDailySummary', () => {
  it('her zaman beş kategoriyi görseldeki sırayla verir', () => {
    expect(DAILY_CATEGORY_IDS).toEqual(['over25', 'ht05', 'sh05', 'btts', 'over25btts'])
    expect(buildDailySummary([], DAY).rows.map((r) => r.categoryId)).toEqual([...DAILY_CATEGORY_IDS])
  })

  it('kategori satırı kazanan / sonuçlanan sayar', () => {
    const picks = [...many(4, 'won'), ...many(2, 'lost')]
    expect(row(picks, 'over25')).toMatchObject({ won: 4, decided: 6 })
    expect(wholePercent(row(picks, 'over25'))).toBe(67)
  })

  it('önerisi olmayan kategori boş kalır (%0 değil) ve genel başarıya girmez', () => {
    const summary = buildDailySummary([...many(3, 'won'), ...many(1, 'lost')], DAY)
    const empty = summary.rows.find((r) => r.categoryId === 'btts')!.tally
    expect(empty).toMatchObject({ decided: 0, total: 0, rate: null })
    expect(wholePercent(empty)).toBeNull()
    expect(summary.overall).toMatchObject({ won: 3, decided: 4 })
  })

  it('değerlendirilemedi ve bekliyor hem paydan hem paydadan hariçtir', () => {
    const picks = [...many(2, 'won', 'btts'), ...many(2, 'lost', 'btts'), ...many(3, 'void', 'btts'), ...many(1, 'pending', 'btts')]
    const summary = buildDailySummary(picks, DAY)
    expect(row(picks, 'btts')).toMatchObject({ won: 2, decided: 4, void: 3, pending: 1 })
    expect(wholePercent(summary.overall)).toBe(50)
  })

  it('yalnızca değerlendirilemeyen önerisi olan kategori de boş sayılır', () => {
    const picks = many(2, 'void', 'ht05')
    expect(wholePercent(row(picks, 'ht05'))).toBeNull()
    expect(wholePercent(buildDailySummary(picks, DAY).overall)).toBeNull()
  })

  it('genel başarı toplam üzerinden hesaplanır, kategori yüzdelerinin ortalaması değildir', () => {
    // 2.5 Üst 1/1 (%100), KG Var 1/9 (%11): ortalama %56 olurdu; doğrusu 2/10 = %20.
    const picks = [...many(1, 'won', 'over25'), ...many(1, 'won', 'btts'), ...many(8, 'lost', 'btts')]
    const summary = buildDailySummary(picks, DAY)
    expect(summary.overall).toMatchObject({ won: 2, decided: 10 })
    expect(wholePercent(summary.overall)).toBe(20)
  })

  it('aynı maç birden çok kategoride öneri ise her öneri ayrı sayılır', () => {
    const picks = [pick('won', 'over25', DAY, 'x'), pick('won', 'btts', DAY, 'x'), pick('lost', 'over25btts', DAY, 'x')]
    expect(buildDailySummary(picks, DAY).overall).toMatchObject({ won: 2, decided: 3 })
  })

  it('farklı günler birbirine karışmaz', () => {
    const picks = [...many(3, 'won', 'over25', '2026-10-04'), ...many(2, 'lost', 'over25', DAY), ...many(1, 'won', 'over25', '2026-10-06')]
    expect(buildDailySummary(picks, DAY).overall).toMatchObject({ won: 0, decided: 2 })
    expect(buildDailySummary(picks, '2026-10-04').overall).toMatchObject({ won: 3, decided: 3 })
    expect(buildDailySummary(picks, '2026-10-07').overall).toMatchObject({ decided: 0, total: 0 })
  })

  it('beş kategorinin dışındaki öneriler (korner, kart, 3.5 üst…) sayılmaz', () => {
    const picks = [...many(2, 'won', 'over25'), ...many(5, 'lost', 'corners95'), ...many(4, 'lost', 'over35'), ...many(3, 'won', 'homeWin15')]
    expect(buildDailySummary(picks, DAY).overall).toMatchObject({ won: 2, decided: 2, total: 2 })
  })

  it('istatistik motoruyla aynı sayıları verir', () => {
    const picks = [
      ...many(4, 'won', 'over25'),
      ...many(2, 'lost', 'over25'),
      ...many(3, 'won', 'sh05'),
      ...many(1, 'void', 'sh05'),
      ...many(2, 'lost', 'over25btts'),
      ...many(6, 'won', 'over25', '2026-10-04'),
    ]
    const stats = buildStats(picks.filter((p) => p.date === DAY))
    const summary = buildDailySummary(picks, DAY)
    expect(summary.overall).toEqual(stats.overall)
    expect(summary.overall).toEqual(stats.daily.find((b) => b.key === DAY)!.tally)
    for (const bucket of stats.byCategory) expect(row(picks, bucket.key)).toEqual(bucket.tally)
  })
})

describe('wholePercent', () => {
  it('tam sayıya yuvarlar; iki kez yuvarlama yapmaz', () => {
    expect(wholePercent(tally([...many(2, 'won'), ...many(1, 'lost')]))).toBe(67)
    expect(wholePercent(tally([...many(1, 'won'), ...many(2, 'lost')]))).toBe(33)
    // 183/370 = %49,46: bir ondalığa (49,5) sonra tam sayıya yuvarlansa yanlışlıkla 50 çıkardı.
    expect(wholePercent(tally([...many(183, 'won'), ...many(187, 'lost')]))).toBe(49)
    expect(wholePercent(tally(many(3, 'lost')))).toBe(0)
    expect(wholePercent(tally(many(3, 'won')))).toBe(100)
  })
})

describe('latestDecidedDate', () => {
  it('sonuçlanmış önerisi olan en son günü verir', () => {
    const picks = [
      ...many(1, 'won', 'over25', '2026-10-03'),
      ...many(1, 'lost', 'btts', '2026-10-05'),
      ...many(1, 'pending', 'btts', '2026-10-06'),
      ...many(1, 'void', 'ht05', '2026-10-07'),
      ...many(1, 'won', 'corners95', '2026-10-08'),
    ]
    expect(latestDecidedDate(picks)).toBe('2026-10-05')
    expect(latestDecidedDate([])).toBeNull()
  })
})

describe('countUnsettledMatches', () => {
  const result = (matchId: string, status: MatchResult['status']) => ({ matchId, status }) as MatchResult

  it('önerilen ama skoru girilmemiş ya da bekleyen benzersiz maçları sayar', () => {
    const picks = [pick('won', 'over25', DAY, 'a'), pick('lost', 'btts', DAY, 'a'), pick('pending', 'over25', DAY, 'b')]
    const results = { a: result('a', 'completed'), b: result('b', 'pending'), e: result('e', 'postponed') }
    // c ve d şu an listede, skoru yok; c iki kategoride önerilse de bir kez sayılır. e ertelendi: sayılmaz.
    expect(countUnsettledMatches(picks, DAY, ['a', 'c', 'c', 'd', 'e'], results)).toBe(3)
    expect(countUnsettledMatches(picks, DAY, ['a'], { a: results.a, b: result('b', 'completed') })).toBe(0)
  })

  it('başka günün ve başka kategorilerin önerilerine bakmaz', () => {
    const picks = [pick('pending', 'over25', '2026-10-04', 'x'), pick('pending', 'corners95', DAY, 'y')]
    expect(countUnsettledMatches(picks, DAY, [], {})).toBe(0)
  })
})
