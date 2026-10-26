import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { MatchResult, Pick, SharedPick } from '../../types'
import { buildHt05NoteStats } from '../stats/ht05NoteStats'
import { memberInput, PICKS, RESULTS } from './__fixtures__/rawData'
import { withOldStats } from './__fixtures__/oldStats'
import { buildMemberPayload, MEMBER_PAYLOAD_VERSION, type MemberPayload } from './payload'
import { assertMemberPayload, MEMBER_HT_SCORELESS, MEMBER_KEYS, MemberPayloadError } from './schema'

// Sürüm 14: üye paketinde yalnızca İY 0.5 ÜST (*) notunu sağlayan maçların sayımı (ht05Note: iki sayı). Değerler
// admin'deki buildHt05NoteStats(...).star ile aynıdır. Sürüm 10-13'ün eski htScoreless alanı yalnızca eski paketlerde.

const TEAM_CANARY = 'Kanarya Spor'
/**
 * Skoru girilmiş sentetik maçlar: ilk `star` tanesi (*) (İY + 2.5 ÜST + 2. YARI 0.5 ÜST), kalanı yalnız İY.
 * Her grupta ilk `scoreless` tanesi İY 0-0, onların ilk `over` tanesi en az 2 gollü.
 */
const extra = (count: number, star: number, scoreless: number, over: number): { picks: Pick[]; results: MatchResult[] } => {
  const ids = Array.from({ length: count }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, '0')}|${TEAM_CANARY} ${i}|rakip`)
  const pick = (matchId: string, categoryId: CategoryId): Pick => ({ id: `${matchId}|${categoryId}`, matchId, categoryId, date: matchId.slice(0, 10), percent: 90, threshold: 80, outcome: 'lost', frozenAt: '' })
  return {
    picks: ids.flatMap((matchId, i) => (i < star ? (['ht05', 'over25', 'sh05'] as const) : (['ht05'] as const)).map((c) => pick(matchId, c))),
    results: ids.map((matchId, i) => {
      const k = i < star ? i : i - star
      return { matchId, status: 'completed', htHome: k < scoreless ? 0 : 1, htAway: 0, ftHome: k < over ? 2 : k < scoreless ? 0 : 1, ftAway: 0, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '' }
    }),
  }
}
const inputOf = (count: number, star: number, scoreless: number, over: number, shared?: SharedPick[]) => {
  const { picks, results } = extra(count, star, scoreless, over)
  return memberInput({ picks: [...PICKS, ...picks], results: [...RESULTS, ...results], ...(shared && { shared }) })
}
const copy = (p: MemberPayload): MemberPayload => JSON.parse(JSON.stringify(p)) as MemberPayload
const withNote = (p: MemberPayload, value: unknown): MemberPayload => {
  const next = copy(p)
  ;(next.statistics.all as { ht05Note: unknown }).ht05Note = value
  return next
}

describe('üye paketi: (*) notlu maçlarda 2. yarı (sürüm 14)', () => {
  it('paket sürümü 14; eşikler eski kutununkiyle aynı tek sabit; anahtarlar', () => {
    expect(MEMBER_PAYLOAD_VERSION).toBe(14)
    expect(MEMBER_HT_SCORELESS).toEqual({ min: 20, low: 50 })
    expect(MEMBER_KEYS.ht05Note).toEqual(['n', 'over'])
    expect(MEMBER_KEYS.stats).toContain('ht05Note')
    expect(MEMBER_KEYS.stats).not.toContain('htScoreless')
    expect(MEMBER_KEYS.statsV13).toContain('htScoreless')
  })

  it('değerler admin hesabıyla (buildHt05NoteStats(...).star) aynı; yalnız İY maçları sayılmaz', () => {
    const input = inputOf(60, 30, 24, 14)
    const payload = buildMemberPayload(input)
    const admin = buildHt05NoteStats(input.picks, input.picks, input.results!).star
    expect(admin.scoreless).toBeGreaterThanOrEqual(24)
    expect(payload.statistics.all.ht05Note).toEqual({ n: admin.scoreless, over: admin.over })
    // Yalnız İY önerili 30 maçın 24'ü de 0-0 bitti; (*) kutusuna girmez.
    expect(payload.statistics.all.ht05Note!.n).toBeLessThan(48)
  })

  it('N < 20 iken de "over" sayıdır (k/n gösterilir; yüzdeyi üye sayfası yazmaz)', () => {
    const input = inputOf(20, 10, 8, 5)
    const note = buildMemberPayload(input).statistics.all.ht05Note!
    expect(note.n).toBeLessThan(MEMBER_HT_SCORELESS.min)
    expect(typeof note.over).toBe('number')
    expect(note).toEqual({ n: buildHt05NoteStats(input.picks, input.picks, input.results!).star.scoreless, over: buildHt05NoteStats(input.picks, input.picks, input.results!).star.over })
  })

  it('"Paylaşılan" ölçüsü: (*) koşulu maçın TÜM önerilerinden; yalnız İY önerisi paylaşılmış maç da sayılır', () => {
    const { picks } = extra(4, 4, 4, 2)
    const shared: SharedPick[] = picks.filter((p) => p.categoryId === 'ht05').map((p) => ({ id: `${p.matchId}|s`, date: p.date, categoryId: 'ht05', matchId: p.matchId, sharedAt: '2026-09-01T09:00:00.000Z', afterKickoff: false }))
    const payload = buildMemberPayload(inputOf(4, 4, 4, 2, shared))
    expect(payload.statistics.shared.ht05Note).toEqual({ n: 4, over: 2 })
  })

  it('pakete yalnızca iki sayı girer: maç, takım, skor ya da öneri kimliği girmez', () => {
    const payload = buildMemberPayload(inputOf(60, 30, 24, 14))
    expect(Object.keys(payload.statistics.all.ht05Note!)).toEqual(['n', 'over'])
    const text = JSON.stringify(payload)
    expect(text).not.toContain(TEAM_CANARY)
    expect(text).not.toContain('|ht05')
    expect(text).not.toMatch(/htScoreless|scored|excluded|scoreless"|under|three|htWon|htHome|ftHome/)
  })

  it('şema (sürüm 14): 0 ≤ over ≤ n; fazladan ya da eksik alan ve eski htScoreless reddedilir', () => {
    const payload = buildMemberPayload(inputOf(60, 30, 24, 14))
    for (const ok of [{ n: 0, over: 0 }, { n: 19, over: 11 }, { n: 20, over: 20 }]) expect(() => assertMemberPayload(withNote(payload, ok)), JSON.stringify(ok)).not.toThrow()
    for (const bad of [{ n: 19, over: null }, { n: 20, over: 21 }, { n: 20, over: -1 }, { n: 20.5, over: 3 }]) expect(() => assertMemberPayload(withNote(payload, bad)), JSON.stringify(bad)).toThrow(MemberPayloadError)
    expect(() => assertMemberPayload(withNote(payload, { n: 24, over: 14, rate: 58.3 }))).toThrow('izinli olmayan alan: rate')
    expect(() => assertMemberPayload(withNote(payload, { n: 24 }))).toThrow('eksik alan: over')
    const missing = copy(payload)
    delete missing.statistics.shared.ht05Note
    expect(() => assertMemberPayload(missing)).toThrow('eksik alan: ht05Note')
    const old = copy(payload)
    old.statistics.all.htScoreless = { n: 24, over: 14 }
    expect(() => assertMemberPayload(old)).toThrow('izinli olmayan alan: htScoreless')
  })

  it('sürüm 13 paket (eski htScoreless, eski kurallarıyla) hâlâ açılır; ht05Note reddedilir; sürüm 15 desteklenmez', () => {
    const payload = buildMemberPayload(inputOf(60, 30, 24, 14))
    const v13 = copy(payload)
    ;(v13 as { v: number }).v = 13
    withOldStats(v13, 13)
    expect(() => assertMemberPayload(v13)).not.toThrow()
    expect(Object.keys(v13.statistics.all)).toEqual(MEMBER_KEYS.statsV13)
    // Sürüm 10-13 kuralı aynen: N < 20 iken over null olmak zorunda.
    const lowOld = copy(v13)
    lowOld.statistics.all.htScoreless = { n: 19, over: 11 }
    expect(() => assertMemberPayload(lowOld)).toThrow("20'den az maçta null bekleniyor")
    const mixed = copy(payload)
    ;(mixed as { v: number }).v = 13
    expect(() => assertMemberPayload(mixed)).toThrow('izinli olmayan alan: ht05Note')
    const future = copy(payload)
    ;(future as { v: number }).v = 15
    expect(() => assertMemberPayload(future)).toThrow('desteklenmeyen paket sürümü')
  })
})
