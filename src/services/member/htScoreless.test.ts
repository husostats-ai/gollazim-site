import { describe, expect, it } from 'vitest'
import type { MatchResult, Pick } from '../../types'
import { buildHtScorelessStats } from '../stats/htScoreless'
import { memberInput, PICKS, RESULTS } from './__fixtures__/rawData'
import { buildMemberPayload, MEMBER_PAYLOAD_VERSION, type MemberPayload } from './payload'
import { assertMemberPayload, MEMBER_HT_SCORELESS, MEMBER_KEYS, MemberPayloadError } from './schema'

/** Sürüm 11'den eski paket: önerilerde piyasa yüzdesi (mkt) alanı yoktur */
const withoutMkt = (p: MemberPayload): void => {
  for (const d of p.days) for (const l of d.lists) for (const i of l.items) delete i.mkt
}

// "İY 0.5 ÜST tutmadığında 2. yarı" sayımının üye paketindeki hâli: yalnızca iki sayı.

const TEAM_CANARY = 'Kanarya Spor'
/** İY 0.5 ÜST önerilmiş, skoru girilmiş maçlar: ilk `scoreless` tanesi İY 0-0, onların ilk `over` tanesi en az 2 gollü */
const extra = (count: number, scoreless: number, over: number): { picks: Pick[]; results: MatchResult[] } => {
  const ids = Array.from({ length: count }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, '0')}|${TEAM_CANARY} ${i}|rakip`)
  return {
    picks: ids.map((matchId) => ({ id: `${matchId}|ht05`, matchId, categoryId: 'ht05', date: matchId.slice(0, 10), percent: 90, threshold: 80, outcome: 'lost', frozenAt: '' })),
    results: ids.map((matchId, i) => ({ matchId, status: 'completed', htHome: i < scoreless ? 0 : 1, htAway: 0, ftHome: i < over ? 2 : i < scoreless ? 0 : 1, ftAway: 0, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '' })),
  }
}
const build = (count: number, scoreless: number, over: number): MemberPayload => {
  const { picks, results } = extra(count, scoreless, over)
  return buildMemberPayload(memberInput({ picks: [...PICKS, ...picks], results: [...RESULTS, ...results] }))
}
/** Fixture'ın kendi önerilerindeki sayım (az sayıda maç) */
const base = buildHtScorelessStats(PICKS, RESULTS)
const copy = (p: MemberPayload): MemberPayload => JSON.parse(JSON.stringify(p)) as MemberPayload
const withHt = (p: MemberPayload, value: unknown): MemberPayload => {
  const next = copy(p)
  ;(next.statistics.all as { htScoreless: unknown }).htScoreless = value
  return next
}

describe('üye paketi: İY 0.5 ÜST tutmadığında 2. yarı (sürüm 10)', () => {
  it('paket sürümü 12; eşikler tek sabittir', () => {
    expect(MEMBER_PAYLOAD_VERSION).toBe(12)
    expect(MEMBER_HT_SCORELESS).toEqual({ min: 20, low: 50 })
    expect(MEMBER_KEYS.htScoreless).toEqual(['n', 'over'])
  })

  it('az maçta (N < 20) yalnızca N yazılır; "over" null', () => {
    const payload = build(30, 19 - base.scoreless, 11)
    expect(payload.statistics.all.htScoreless).toEqual({ n: 19, over: null })
  })

  it('N ≥ 20 olunca "over" da yazılır; sayılar admin kutusunun hesabıyla aynıdır', () => {
    const { picks, results } = extra(40, 24, 14)
    const payload = buildMemberPayload(memberInput({ picks: [...PICKS, ...picks], results: [...RESULTS, ...results] }))
    const admin = buildHtScorelessStats([...PICKS, ...picks], [...RESULTS, ...results])
    expect(admin.scoreless).toBeGreaterThanOrEqual(MEMBER_HT_SCORELESS.min)
    expect(payload.statistics.all.htScoreless).toEqual({ n: admin.scoreless, over: admin.over })
    // Tam eşikte de yazılır
    expect(build(30, 20 - base.scoreless, 5).statistics.all.htScoreless).toMatchObject({ n: 20 })
    expect(build(30, 20 - base.scoreless, 5).statistics.all.htScoreless!.over).not.toBeNull()
  })

  it('"Paylaşılan" ölçüsü kendi sayımını taşır', () => {
    const payload = build(40, 24, 14)
    const shared = payload.statistics.shared.htScoreless!
    expect(shared.n).toBeLessThan(MEMBER_HT_SCORELESS.min)
    expect(shared.over).toBeNull()
  })

  it('skorlar verilmezse günlerin skorları kullanılır; skoru olmayan öneri sayılmaz', () => {
    expect(buildMemberPayload(memberInput()).statistics.all.htScoreless).toEqual({ n: base.scoreless, over: null })
    const { picks } = extra(40, 24, 14)
    expect(buildMemberPayload(memberInput({ picks: [...PICKS, ...picks] })).statistics.all.htScoreless).toEqual({ n: base.scoreless, over: null })
  })

  it('pakete yalnızca iki sayı girer: maç, takım, skor ya da öneri kimliği girmez', () => {
    const payload = build(40, 24, 14)
    expect(Object.keys(payload.statistics.all.htScoreless!)).toEqual(['n', 'over'])
    const text = JSON.stringify(payload)
    expect(text).not.toContain(TEAM_CANARY)
    expect(text).not.toContain('|ht05')
    // Önerilerin günü yalnızca günlük başarı dökümünün anahtarı olarak geçer (mevcut davranış); bu kutuya gün yazılmaz.
    expect(JSON.stringify(payload.statistics.all.htScoreless)).toBe(`{"n":${24 + base.scoreless},"over":${14 + base.over}}`)
    expect(text).not.toMatch(/scored|excluded|scoreless"|under|htHome|ftHome/)
  })

  it('şema: N < 20 iken "over" null olmak zorunda; değilse 0 ≤ over ≤ n', () => {
    const payload = build(40, 24, 14)
    expect(() => assertMemberPayload(withHt(payload, { n: 19, over: null }))).not.toThrow()
    expect(() => assertMemberPayload(withHt(payload, { n: 0, over: null }))).not.toThrow()
    expect(() => assertMemberPayload(withHt(payload, { n: 19, over: 11 }))).toThrow(MemberPayloadError)
    expect(() => assertMemberPayload(withHt(payload, { n: 19, over: 0 }))).toThrow("20'den az maçta null bekleniyor")
    expect(() => assertMemberPayload(withHt(payload, { n: 20, over: 20 }))).not.toThrow()
    expect(() => assertMemberPayload(withHt(payload, { n: 20, over: 0 }))).not.toThrow()
    expect(() => assertMemberPayload(withHt(payload, { n: 20, over: null }))).toThrow(MemberPayloadError)
    expect(() => assertMemberPayload(withHt(payload, { n: 20, over: 21 }))).toThrow(MemberPayloadError)
    expect(() => assertMemberPayload(withHt(payload, { n: 20, over: -1 }))).toThrow(MemberPayloadError)
    expect(() => assertMemberPayload(withHt(payload, { n: 20.5, over: 3 }))).toThrow(MemberPayloadError)
  })

  it('şema: fazladan alan (oran, maç listesi) ve eksik alan reddedilir', () => {
    const payload = build(40, 24, 14)
    expect(() => assertMemberPayload(withHt(payload, { n: 24, over: 14, rate: 58.3 }))).toThrow('izinli olmayan alan: rate')
    expect(() => assertMemberPayload(withHt(payload, { n: 24, over: 14, matches: [TEAM_CANARY] }))).toThrow('izinli olmayan alan: matches')
    expect(() => assertMemberPayload(withHt(payload, { n: 24 }))).toThrow('eksik alan: over')
    const missing = copy(payload)
    delete missing.statistics.shared.htScoreless
    expect(() => assertMemberPayload(missing)).toThrow('eksik alan: htScoreless')
  })

  it('sürüm 9 paket (bu alan olmadan) hâlâ açılır; sürümler karıştırılamaz', () => {
    const v9 = copy(build(40, 24, 14))
    ;(v9 as { v: number }).v = 9
    withoutMkt(v9)
    for (const scope of ['all', 'shared'] as const) delete v9.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v9)).not.toThrow()
    expect(Object.keys(v9.statistics.all)).toEqual(MEMBER_KEYS.statsV9)
    // Sürüm 9 pakette alan bulunamaz; sürüm 10 pakette bulunmak zorundadır.
    const mixed = copy(build(40, 24, 14))
    ;(mixed as { v: number }).v = 9
    withoutMkt(mixed)
    expect(() => assertMemberPayload(mixed)).toThrow('izinli olmayan alan: htScoreless')
    const future = copy(build(40, 24, 14))
    ;(future as { v: number }).v = 13
    expect(() => assertMemberPayload(future)).toThrow('desteklenmeyen paket sürümü')
  })
})
