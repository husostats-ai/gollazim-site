import { describe, expect, it } from 'vitest'
import { defaultThresholds, isCategoryId, type CategoryId } from '../../config/categories'
import type { BackupFile, MatchResult, Pick, PickOutcome, SharedPick } from '../../types'
import { isBackupFile } from '../data/backupFormat'
import { DAILY_TEXT, drawDailyStory } from '../image/dailyStory'
import { recordingContext } from '../image/recordingContext'
import { buildDailySummary, countUnsettledMatches, wholePercent } from '../stats/dailySummary'
import { buildStats } from '../stats/statsEngine'
import {
  activeShared,
  findActiveShared,
  isAfterKickoff,
  normalizeShared,
  recordShare,
  removeShare,
  sharedId,
  sharedPicksOnly,
  sharedWithoutPick,
} from './shared'

const DAY = '2026-10-05'
// 5 Ekim 2026, Türkiye saatiyle 12:00 / 21:30 / ertesi gün 09:00
const NOON = '2026-10-05T09:00:00.000Z'
const NIGHT = '2026-10-05T18:30:00.000Z'
const NEXT_MORNING = '2026-10-06T06:00:00.000Z'
const match = (id: string, time: string | null = '20:00', date = DAY) => ({ id, date, time: time ?? undefined })
const share = (existing: SharedPick[], ids: string[], now = NOON, categoryId: CategoryId = 'over25', date = DAY) =>
  recordShare(existing, { date, categoryId, matches: ids.map((id) => match(id, '20:00', date)), now })

describe('isAfterKickoff', () => {
  it('saat Türkiye saatine göre karşılaştırılır; başlama anı da "başladı" sayılır', () => {
    expect(isAfterKickoff(match('a', '20:00'), '2026-10-05T16:59:59.000Z')).toBe(false) // 19:59:59
    expect(isAfterKickoff(match('a', '20:00'), '2026-10-05T17:00:00.000Z')).toBe(true) // 20:00
    expect(isAfterKickoff(match('a', '20:00'), NEXT_MORNING)).toBe(true)
    // Gece yarısından sonraki maç: 6 Ekim 00:30 = 5 Ekim 21:30 UTC
    expect(isAfterKickoff(match('a', '00:30', '2026-10-06'), '2026-10-05T21:00:00.000Z')).toBe(false)
    expect(isAfterKickoff(match('a', '00:30', '2026-10-06'), '2026-10-05T21:30:00.000Z')).toBe(true)
  })

  it('saat bilinmiyorsa yalnızca gün geçmişse başlamış sayılır', () => {
    expect(isAfterKickoff(match('a', null), NIGHT)).toBe(false)
    expect(isAfterKickoff(match('a', null), '2026-10-05T20:59:00.000Z')).toBe(false) // 23:59
    expect(isAfterKickoff(match('a', null), '2026-10-05T21:00:00.000Z')).toBe(true) // ertesi gün 00:00
  })
})

describe('recordShare (birleşim)', () => {
  it('görseldeki maçları gün + kategori + zaman damgasıyla kaydeder', () => {
    const added = share([], ['a', 'b'])
    expect(added).toEqual([
      { id: `${DAY}|over25|a|${NOON}`, date: DAY, categoryId: 'over25', matchId: 'a', sharedAt: NOON, afterKickoff: false },
      { id: `${DAY}|over25|b|${NOON}`, date: DAY, categoryId: 'over25', matchId: 'b', sharedAt: NOON, afterKickoff: false },
    ])
  })

  it('ikinci görsel öncekilerle birleşir; yeniden üretmek kimseyi çıkarmaz ve ilk zamanı değiştirmez', () => {
    const first = share([], ['a', 'b'])
    // İkinci görselde yalnızca b ve c var
    const second = share(first, ['b', 'c'], NIGHT)
    expect(second.map((r) => r.matchId)).toEqual(['c'])
    const all = [...first, ...second]
    expect(activeShared(all).map((r) => r.matchId)).toEqual(['a', 'b', 'c'])
    expect(findActiveShared(all, DAY, 'over25', 'b')!.sharedAt).toBe(NOON)
    // Aynı görseli bir daha üretmek hiçbir şey eklemez
    expect(share(all, ['a', 'b', 'c'], NEXT_MORNING)).toEqual([])
  })

  it('aynı çağrıda tekrar eden maç bir kez kaydedilir', () => {
    expect(share([], ['a', 'a'])).toHaveLength(1)
  })

  it('başka kategori ve başka gün ayrı kayıttır', () => {
    const over25 = share([], ['a'])
    const btts = share(over25, ['a'], NOON, 'btts')
    const nextDay = share([...over25, ...btts], ['a'], NOON, 'over25', '2026-10-06')
    expect(btts).toHaveLength(1)
    expect(nextDay).toHaveLength(1)
    const all = [...over25, ...btts, ...nextDay]
    expect(findActiveShared(all, DAY, 'btts', 'a')).toBeDefined()
    expect(findActiveShared(all, DAY, 'ht05', 'a')).toBeUndefined()
    expect(findActiveShared(all, '2026-10-07', 'over25', 'a')).toBeUndefined()
  })

  it('maç başladıktan sonra yapılan kayıt işaretlenir', () => {
    const added = recordShare([], { date: DAY, categoryId: 'over25', matches: [match('erken', '15:00'), match('gec', '23:00')], now: NIGHT })
    expect(added.map((r) => [r.matchId, r.afterKickoff])).toEqual([
      ['erken', true],
      ['gec', false],
    ])
  })
})

describe('removeShare (çıkarma geçmişi)', () => {
  const first = share([], ['a', 'b'])

  it('kayıt silinmez, çıkarıldı olarak işaretlenir', () => {
    const after = removeShare(first, DAY, 'over25', 'a', NIGHT)
    expect(after).toHaveLength(2)
    expect(after.find((r) => r.matchId === 'a')).toMatchObject({ sharedAt: NOON, removedAt: NIGHT })
    expect(activeShared(after).map((r) => r.matchId)).toEqual(['b'])
    // Girdi değişmez
    expect(first.every((r) => r.removedAt === undefined)).toBe(true)
  })

  it('çıkarılan maç yeniden paylaşılırsa eski kayıt geçmişte kalır, yeni kayıt açılır', () => {
    const removed = removeShare(first, DAY, 'over25', 'a', NIGHT)
    const again = share(removed, ['a'], NEXT_MORNING)
    expect(again).toHaveLength(1)
    const all = [...removed, ...again]
    const history = all.filter((r) => r.matchId === 'a')
    expect(history.map((r) => [r.sharedAt, r.removedAt])).toEqual([
      [NOON, NIGHT],
      [NEXT_MORNING, undefined],
    ])
    expect(new Set(all.map((r) => r.id)).size).toBe(3)
    expect(findActiveShared(all, DAY, 'over25', 'a')!.afterKickoff).toBe(true)
  })

  it('geçerli kaydı olmayan maç için hiçbir şey değişmez', () => {
    expect(removeShare(first, DAY, 'over25', 'yok', NIGHT)).toBe(first)
    expect(removeShare(first, DAY, 'btts', 'a', NIGHT)).toBe(first)
  })
})

let n = 0
const pick = (matchId: string, categoryId: CategoryId, outcome: PickOutcome, date = DAY): Pick => ({
  id: `p${++n}`,
  matchId,
  categoryId,
  date,
  percent: 80,
  threshold: 75,
  outcome,
  frozenAt: NIGHT,
})

describe('paylaşılan ölçüsüyle günlük hesap', () => {
  // 2.5 Üst: 6 dondurulmuş öneri (3 kazandı, 3 kaybetti); paylaşılan 3'ü (2 kazandı, 1 kaybetti)
  const picks = [
    pick('a', 'over25', 'won'),
    pick('b', 'over25', 'won'),
    pick('c', 'over25', 'lost'),
    pick('d', 'over25', 'won'),
    pick('e', 'over25', 'lost'),
    pick('f', 'over25', 'lost'),
    // KG Var: a ve b önerildi; yalnızca b paylaşıldı ve değerlendirilemedi
    pick('a', 'btts', 'won'),
    pick('b', 'btts', 'void'),
    // İY 0.5: hiçbiri paylaşılmadı
    pick('a', 'ht05', 'won'),
    pick('c', 'ht05', 'lost'),
    // 2. Yarı 0.5: a paylaşıldı, bekliyor
    pick('a', 'sh05', 'pending'),
    // Başka gün: aynı maç kimliği ve kategori, paylaşılmadı
    pick('a', 'over25', 'lost', '2026-10-04'),
    // Görselin dışındaki kategori
    pick('a', 'corners95', 'won'),
  ]
  const records = [
    ...share([], ['a', 'b', 'c']),
    ...share([], ['b'], NOON, 'btts'),
    ...share([], ['a'], NOON, 'sh05'),
    ...share([], ['a'], NOON, 'corners95'),
  ]
  const shared = sharedPicksOnly(picks, records)
  const summary = buildDailySummary(shared, DAY)
  const row = (id: CategoryId) => summary.rows.find((r) => r.categoryId === id)!.tally

  it('her kategori yalnızca o kategoride paylaşılan önerileri sayar', () => {
    expect(row('over25')).toMatchObject({ won: 2, decided: 3 })
    expect(wholePercent(row('over25'))).toBe(67)
    // Tüm önerilerle aynı kategori 3/6 olurdu
    expect(buildDailySummary(picks, DAY).rows.find((r) => r.categoryId === 'over25')!.tally).toMatchObject({ won: 3, decided: 6 })
  })

  it('bir kategoride paylaşılmış olmak başka kategoride saydırmaz', () => {
    // a, 2.5 Üst'te paylaşıldı ama KG Var'da ve İY 0.5'te paylaşılmadı
    expect(shared.some((p) => p.matchId === 'a' && p.categoryId === 'btts')).toBe(false)
    expect(row('ht05')).toMatchObject({ total: 0, decided: 0 })
    expect(wholePercent(row('ht05'))).toBeNull()
  })

  it('değerlendirilemedi ve bekleyen paylaşılanlar orana girmez; boş kategori "—" kalır', () => {
    expect(row('btts')).toMatchObject({ void: 1, decided: 0, rate: null })
    expect(wholePercent(row('btts'))).toBeNull()
    expect(row('sh05')).toMatchObject({ pending: 1, decided: 0 })
    expect(wholePercent(row('over25btts'))).toBeNull()
  })

  it('genel başarı paylaşılanların toplamı üzerinden hesaplanır', () => {
    expect(summary.overall).toMatchObject({ won: 2, decided: 3, void: 1, pending: 1 })
    expect(wholePercent(summary.overall)).toBe(67)
    expect(buildDailySummary(picks, DAY).overall).toMatchObject({ won: 5, decided: 9 })
  })

  it('başka günün aynı maçı karışmaz; çıkarılan kayıt sayılmaz', () => {
    expect(shared.every((p) => p.date === DAY)).toBe(true)
    const removed = removeShare(records, DAY, 'over25', 'a', NIGHT)
    expect(buildDailySummary(sharedPicksOnly(picks, removed), DAY).overall).toMatchObject({ won: 1, decided: 2 })
  })

  it('hiç paylaşılan yoksa tüm satırlar boştur', () => {
    const empty = buildDailySummary(sharedPicksOnly(picks, []), DAY)
    expect(empty.overall).toMatchObject({ total: 0, rate: null })
    expect(empty.rows.every((r) => wholePercent(r.tally) === null)).toBe(true)
  })

  it('istatistik motoru paylaşılan önerilerle de aynı kuralları uygular', () => {
    const stats = buildStats(shared)
    expect(stats.overall).toMatchObject({ won: 3, decided: 4 }) // korner 9.5 dahil
    expect(stats.byCategory.map((b) => b.key)).toEqual(['over25', 'btts', 'sh05', 'corners95'])
  })

  it('"henüz sonuçlanmadı" paylaşılanlar için: skoru girilmemiş ya da bekleyen paylaşılan maçlar', () => {
    const result = (matchId: string, status: MatchResult['status']) => ({ matchId, status }) as MatchResult
    const daily = activeShared(records).filter((r) => r.categoryId !== 'corners95')
    const ids = daily.map((r) => r.matchId)
    // a: sonuç "tamamlanmadı"; b: tamamlandı; c: skor yok
    expect(countUnsettledMatches(shared, DAY, ids, { a: result('a', 'pending'), b: result('b', 'completed') })).toBe(2)
    expect(countUnsettledMatches(shared, DAY, ids, { a: result('a', 'completed'), b: result('b', 'completed'), c: result('c', 'completed') })).toBe(0)
  })

  it('skoru girilmiş ama dondurulmuş önerisi olmayan paylaşılan kayıt ayrıca sayılır', () => {
    const extra = [...records, ...share(records, ['z'])]
    expect(sharedWithoutPick(extra, picks, new Set(['a', 'b', 'c', 'z']))).toBe(1)
    expect(sharedWithoutPick(extra, picks, new Set(['a', 'b', 'c']))).toBe(0)
  })
})

describe('görselde ölçü yazar', () => {
  const texts = (scope?: 'shared' | 'all') => {
    const { ctx, texts: drawn } = recordingContext()
    drawDailyStory(ctx, buildDailySummary([], DAY), '5 Ekim 2026', null, undefined, scope)
    return drawn.map((t) => t.text)
  }

  it('alt başlık ölçüye göre değişir; genel kart ve alt not aynı kalır', () => {
    expect(texts('shared')).toContain('Paylaşılan önerilerin sonuçları')
    expect(texts('shared')).not.toContain('Tüm önerilerin sonuçları')
    expect(texts('all')).toContain('Tüm önerilerin sonuçları')
    expect(texts()).toContain('Tüm önerilerin sonuçları')
    const strip = (list: string[]) => list.filter((t) => t !== DAILY_TEXT.subtitle.shared && t !== DAILY_TEXT.subtitle.all)
    expect(strip(texts('shared'))).toEqual(strip(texts('all')))
  })
})

describe('yedek ve geri yükleme', () => {
  const records = removeShare([...share([], ['a', 'b']), ...share([], ['a'], NIGHT, 'btts')], DAY, 'over25', 'b', NIGHT)
  const backup = (extra: Partial<BackupFile>): unknown => ({
    app: 'gollazim',
    version: 1,
    exportedAt: NEXT_MORNING,
    uploads: [],
    matches: [],
    results: [],
    picks: [],
    thresholds: defaultThresholds(),
    ...extra,
  })

  it('kayıtlar, çıkarılmış olanlar ve maç sonrası işareti dahil, aynen geri gelir', () => {
    const file = JSON.parse(JSON.stringify(backup({ sharedPicks: records }))) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    const restored = normalizeShared(file.sharedPicks, isCategoryId)
    expect(restored).toEqual(records)
    expect(restored.find((r) => r.matchId === 'b')!.removedAt).toBe(NIGHT)
    // KG Var kaydı 21:30'da, maç (20:00) başladıktan sonra yapıldı
    expect(restored.find((r) => r.categoryId === 'btts')!.afterKickoff).toBe(true)
    expect(restored.find((r) => r.categoryId === 'over25' && r.matchId === 'a')!.afterKickoff).toBe(false)
  })

  it('kaydı olmayan eski yedek geçerlidir; bozuk satırlar atılır', () => {
    expect(isBackupFile(backup({}))).toBe(true)
    expect(isBackupFile(backup({ sharedPicks: {} as never }))).toBe(false)
    expect(normalizeShared(undefined, isCategoryId)).toEqual([])
    const dirty = [
      { date: DAY, categoryId: 'bilinmeyen', matchId: 'a', sharedAt: NOON },
      { date: DAY, categoryId: 'over25', matchId: 5, sharedAt: NOON },
      { date: DAY, categoryId: 'over25', matchId: 'a' },
      null,
      { id: 'yanlis', date: DAY, categoryId: 'over25', matchId: 'a', sharedAt: NOON, afterKickoff: 'evet', removedAt: 7 },
    ]
    expect(normalizeShared(dirty, isCategoryId)).toEqual([
      { id: sharedId(DAY, 'over25', 'a', NOON), date: DAY, categoryId: 'over25', matchId: 'a', sharedAt: NOON, afterKickoff: false },
    ])
  })
})
