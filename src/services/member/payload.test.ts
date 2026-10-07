import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import { describe, expect, it } from 'vitest'
import { CATEGORIES, MAX_MATCHES_PER_CATEGORY } from '../../config/categories'
import { DEFAULT_MEMBER_TEXTS, normalizeMemberTexts } from '../../config/memberTexts'
import type { Pick } from '../../types'
import { analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { buildStarStats } from '../stats/starStats'
import { buildStats } from '../stats/statsEngine'
import { sharedPicksOnly } from '../story/shared'
import { DAY, dayMatches, MARKET_LIMIT, memberInput, PICKS, PREVIOUS_DAY, PUBLISHED_AT, SHARED, THRESHOLDS } from './__fixtures__/rawData'
import { buildMemberPayload, conflictKindOf, MEMBER_DAILY_LIMIT, MEMBER_PAYLOAD_VERSION, type MemberDay } from './payload'

const payload = buildMemberPayload(memberInput())
const today = payload.days[0]
const list = (day: MemberDay, categoryId: string) => day.lists.find((l) => l.categoryId === categoryId)!
const matchOf = (day: MemberDay, home: string) => day.matches.findIndex((m) => m.home === home)

describe('buildMemberPayload', () => {
  it('sürüm, yayın numarası, yayın zamanı ve metinleri taşır', () => {
    expect(payload.v).toBe(MEMBER_PAYLOAD_VERSION)
    expect(payload.n).toBe(7)
    expect(payload.publishedAt).toBe(PUBLISHED_AT)
    expect(payload.texts).toEqual(DEFAULT_MEMBER_TEXTS)
  })

  it('günler verilen sırayla gelir; her günde kayıt defterindeki sırayla 17 liste vardır', () => {
    expect(payload.days.map((d) => d.date)).toEqual([DAY, PREVIOUS_DAY])
    for (const day of payload.days) expect(day.lists.map((l) => l.categoryId)).toEqual(CATEGORIES.map((c) => c.id))
  })

  it('listeler admin ekranındaki analizle aynıdır: aynı maçlar, aynı sıra, aynı yüzde, yıldız ve seviye', () => {
    const analysis = analyzeDay(dayMatches(DAY), THRESHOLDS, 'percent', MARKET_LIMIT)
    let listed = 0
    for (const category of CATEGORIES) {
      const expected = analysis[category.id].predictions.map((p) => [p.match.home, p.match.away, p.percent, p.stars, p.reliability.level, p.secondPercent ?? null])
      const actual = list(today, category.id).items.map((i) => [today.matches[i.match].home, today.matches[i.match].away, i.percent, i.stars, i.reliability, i.model])
      expect(actual).toEqual(expected)
      listed += actual.length
    }
    // Veri boş değil: gol, korner, kart ve Taraf & Gol listelerinin hepsinde öneri var.
    expect(listed).toBeGreaterThan(40)
    for (const id of ['over25', 'over25btts', 'corners85', 'cards35', 'homeWin15', 'awayWin15']) expect(list(today, id).items.length).toBeGreaterThan(0)
  })

  it('her listede en fazla 15 maç vardır ve sıra listedeki sıradır', () => {
    const many = Array.from({ length: 20 }, (_, i) => makeMatch({ over25Pct: 80 + i }, { id: `cok-${i}`, date: DAY, home: `Ev ${i}`, away: `Dep ${i}` }))
    const day = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: many, results: [] }], picks: [], shared: [], leagueTables: [] })).days[0]
    const items = list(day, 'over25').items
    expect(items).toHaveLength(MAX_MATCHES_PER_CATEGORY)
    expect(items.map((i) => i.percent)).toEqual(Array.from({ length: 15 }, (_, i) => 99 - i))
    // Listeye girmeyen maçlar pakete hiç yazılmaz.
    expect(day.matches).toHaveLength(15)
  })

  it('model yüzdesi ve model çelişkisi: yalnızca ikinci hesabı olan kategorilerde', () => {
    const conflicted = list(today, 'over25').items.find((i) => today.matches[i.match].home === 'İç Anadolu FK')!
    expect(conflicted).toMatchObject({ percent: 100, conflict: 'model' })
    expect(conflicted.model).not.toBeNull()
    expect(list(today, 'ht05').items.every((i) => i.model === null && i.conflict === null)).toBe(true)
    expect(list(today, 'corners85').items.every((i) => i.model === null && i.reliability === 'unmeasured')).toBe(true)
  })

  it('çelişki türü: ana gol kategorilerinde "model", Taraf & Gol listelerinde "hesap"', () => {
    const analysis = analyzeDay(dayMatches(DAY), THRESHOLDS, 'percent', MARKET_LIMIT)
    const kinds = new Set<string>()
    for (const category of CATEGORIES) {
      const expected = analysis[category.id].predictions.map((p) => (p.notes.some((n) => n.kind === 'conflict') ? conflictKindOf(category.id) : null))
      expect(list(today, category.id).items.map((i) => i.conflict)).toEqual(expected)
      expected.forEach((kind) => kind && kinds.add(`${category.group ?? 'tek'}:${kind}`))
    }
    // Veride iki tür de var; türler karışmıyor.
    expect([...kinds].sort()).toEqual(['bolgol:model', 'sidegoals:hesap', 'tek:model'])
    expect(conflictKindOf('awayWin25')).toBe('hesap')
    expect(conflictKindOf('btts')).toBe('model')
  })

  it('skor girilen maçta skor, sonuç ve kategoriye özgü ayrıntı; girilmeyende hepsi boş', () => {
    const done = matchOf(today, 'Kuzey Yıldızı')
    expect(today.matches[done]).toMatchObject({ status: 'completed', score: 'İY 1-0 · MS 3-1' })
    const of = (categoryId: string) => list(today, categoryId).items.find((i) => i.match === done)!
    expect(of('over25')).toMatchObject({ outcome: 'won', detail: null })
    expect(of('ht05')).toMatchObject({ outcome: 'won', detail: 'İY 1-0' })
    expect(of('sh05')).toMatchObject({ outcome: 'won', detail: '2Y 2-1' })
    expect(of('corners85')).toMatchObject({ outcome: 'won', detail: 'Korner 12' })
    expect(of('cards35')).toMatchObject({ outcome: 'won', detail: 'Kart 5' })

    // Korner girilmeden tamamlanan maç: değerlendirilemedi, ayrıntı yok
    const noCorners = matchOf(today, 'Doğu Gençlik')
    expect(list(today, 'corners85').items.find((i) => i.match === noCorners)).toMatchObject({ outcome: 'void', detail: null })

    const open = matchOf(today, 'Yayla Gençlerbirliği')
    expect(today.matches[open]).toMatchObject({ status: null, score: null })
    expect(list(today, 'over25').items.find((i) => i.match === open)).toMatchObject({ outcome: null, detail: null })

    // Ertelenen maç: durum yazılır, skor ve sonuç yoktur
    const postponed = matchOf(today, 'Ova Belediyespor')
    expect(today.matches[postponed]).toMatchObject({ status: 'postponed', score: null })
    expect(list(today, 'over25').items.find((i) => i.match === postponed)!.outcome).toBeNull()
  })

  it('lig tablosundan yalnızca sıra ve oynanan maç; tabloda olmayan takımda null', () => {
    expect(today.matches[matchOf(today, 'Kuzey Yıldızı')]).toEqual(expect.objectContaining({ homeStanding: { rank: 1, played: 8, stale: false }, awayStanding: { rank: 4, played: 7, stale: false } }))
    expect(today.matches[matchOf(today, 'Doğu Gençlik')]).toEqual(expect.objectContaining({ homeStanding: { rank: 9, played: 8, stale: false }, awayStanding: null }))
    expect(today.matches[matchOf(today, 'Yayla Gençlerbirliği')]).toMatchObject({ homeStanding: null, awayStanding: null })
  })

  it('tablo yayın anında 7 günden eskiyse "güncel değil" bayrağı; tam 7 günde değil', () => {
    // Tablo 4 Ekim'de yapıştırıldı.
    const staleAt = (publishedAt: string) => {
      const day = buildMemberPayload(memberInput({ publishedAt })).days[0]
      return day.matches[matchOf(day, 'Kuzey Yıldızı')].homeStanding
    }
    expect(staleAt('2026-10-11T09:00:00.000Z')).toEqual({ rank: 1, played: 8, stale: false })
    expect(staleAt('2026-10-12T09:00:00.000Z')).toEqual({ rank: 1, played: 8, stale: true })
  })

  it('istatistik değerleri istatistik sayfasının hesabıyla aynıdır (Tümü ve Paylaşılan)', () => {
    for (const [scope, picks] of [['all', PICKS], ['shared', sharedPicksOnly(PICKS, SHARED)]] as const) {
      const expected = buildStats(picks)
      const stars = buildStarStats(picks)
      const actual = payload.statistics[scope]
      expect(actual.overall).toEqual(expected.overall)
      expect(actual.matches).toEqual(expected.matches)
      expect(actual.byCategory).toEqual(expected.byCategory)
      expect(actual.byReliability).toEqual(expected.byReliability)
      expect(actual.daily).toEqual(expected.daily)
      expect(actual.weekly).toEqual(expected.weekly)
      expect(actual.monthly).toEqual(expected.monthly)
      expect(actual.stars).toEqual(stars)
      // Ana kategoriler: aynı hesap, yalnızca sabit listedeki kategorilerin önerileriyle.
      const mainPicks = picks.filter((p) => (MAIN_CATEGORY_IDS as readonly string[]).includes(p.categoryId))
      const main = buildStats(mainPicks)
      expect(actual.main).toEqual({ categories: [...MAIN_CATEGORY_IDS], overall: main.overall, matches: main.matches })
    }
    // Sabit liste gerçekten bir alt kümedir: ana kategoriler tüm önerilerden azdır.
    expect(payload.statistics.all.main!.overall.total).toBeGreaterThan(0)
    expect(payload.statistics.all.main!.overall.total).toBeLessThan(payload.statistics.all.overall.total)
    expect(payload.statistics.all.overall.total).toBe(PICKS.length)
    expect(payload.statistics.shared.overall.total).toBe(2)
  })

  it('günlük döküm en yeni 90 günle sınırlanır', () => {
    const pick = (i: number): Pick => {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
      return { id: `g${i}|over25`, matchId: `g${i}`, categoryId: 'over25', date, percent: 80, threshold: 75, outcome: 'won', frozenAt: PUBLISHED_AT }
    }
    const daily = buildMemberPayload(memberInput({ picks: Array.from({ length: 120 }, (_, i) => pick(i)), shared: [] })).statistics.all.daily
    expect(daily).toHaveLength(MEMBER_DAILY_LIMIT)
    expect(daily[0].key).toBe('2026-01-31')
    expect(daily[daily.length - 1].key).toBe('2026-04-30')
  })

  it('maçı olmayan gün boş listelerle, önerisi olmayan veri boş istatistikle kurulur', () => {
    const empty = buildMemberPayload(memberInput({ days: [{ date: '2026-10-09', matches: [], results: [] }], picks: [], shared: [] }))
    expect(empty.days[0].matches).toEqual([])
    expect(empty.days[0].lists.every((l) => l.items.length === 0)).toBe(true)
    expect(empty.statistics.all.overall).toMatchObject({ total: 0, rate: null })
  })

  it('saf fonksiyondur: aynı girdi aynı paketi verir ve girdiyi değiştirmez', () => {
    const input = memberInput()
    const before = JSON.stringify(input)
    expect(JSON.stringify(buildMemberPayload(input))).toBe(JSON.stringify(payload))
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('normalizeMemberTexts', () => {
  it('kayıt yoksa ya da metin boşsa varsayılan; uzun metin kısaltılır', () => {
    expect(normalizeMemberTexts(undefined)).toEqual(DEFAULT_MEMBER_TEXTS)
    expect(normalizeMemberTexts({ disclaimer: '   ', account: 7 })).toEqual(DEFAULT_MEMBER_TEXTS)
    expect(normalizeMemberTexts({ disclaimer: '  Yeni uyarı  ' }).disclaimer).toBe('Yeni uyarı')
    expect(normalizeMemberTexts({ account: 'x'.repeat(500) }).account).toHaveLength(200)
  })
})
