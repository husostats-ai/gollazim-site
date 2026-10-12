import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Pick, PickOutcome } from '../../types'
import { buildMarginStats, MARGIN_BANDS, marginOf, RAISED_STEPS } from './marginStats'

// Eşik üstü puan = kayıtlı yüzde − kayıtlı eşik. Değerler sentetiktir.

let n = 0
const pick = (percent: number, outcome: PickOutcome = 'won', extra: Partial<Pick> = {}, categoryId: CategoryId = 'over25'): Pick => ({
  id: `g${++n}`,
  matchId: `gm${n}`,
  categoryId,
  date: '2026-10-05',
  percent,
  threshold: 75,
  outcome,
  frozenAt: '',
  ...extra,
})
const bandTotals = (picks: Pick[], row = 0) => buildMarginStats(picks).rows[row].bands.map((t) => t.total)

describe('eşik üstü puan bantları', () => {
  it('bantlar: +0–5, +5–10, +10–15, +15–25, +25 ve üstü', () => {
    expect(MARGIN_BANDS.map((b) => b.label)).toEqual(['+0–5', '+5–10', '+10–15', '+15–25', '+25 ve üstü'])
    expect(RAISED_STEPS).toEqual([5, 10])
  })

  it('alt sınır banda dahil, üst sınır değil: 0, 4, 5, 9, 10, 14, 15, 24, 25', () => {
    const at = (margin: number) => bandTotals([pick(75 + margin)])
    expect(at(0)).toEqual([1, 0, 0, 0, 0])
    expect(at(4)).toEqual([1, 0, 0, 0, 0])
    expect(at(5)).toEqual([0, 1, 0, 0, 0])
    expect(at(9)).toEqual([0, 1, 0, 0, 0])
    expect(at(10)).toEqual([0, 0, 1, 0, 0])
    expect(at(14)).toEqual([0, 0, 1, 0, 0])
    expect(at(15)).toEqual([0, 0, 0, 1, 0])
    expect(at(24)).toEqual([0, 0, 0, 1, 0])
    expect(at(25)).toEqual([0, 0, 0, 0, 1])
    expect(bandTotals([pick(100, 'won', { threshold: 45 })])).toEqual([0, 0, 0, 0, 1])
  })

  it('ondalıklı yüzdede de aynı kural: 79,9 → +0–5, 80 → +5–10', () => {
    expect(bandTotals([pick(79.9)])).toEqual([1, 0, 0, 0, 0])
    expect(bandTotals([pick(80)])).toEqual([0, 1, 0, 0, 0])
  })

  it('eşik, önerinin KAYITLI eşiğidir: aynı yüzde farklı eşikle farklı banda düşer', () => {
    expect(marginOf(pick(86, 'won', { threshold: 80 }))).toBe(6)
    const stats = buildMarginStats([pick(86, 'won', { threshold: 75 }), pick(86, 'lost', { threshold: 80 }), pick(86, 'won', { threshold: 85 })])
    expect(stats.rows[0].bands.map((t) => t.total)).toEqual([1, 1, 1, 0, 0])
    // Kategoride birden çok kayıtlı eşik varsa hepsi, küçükten büyüğe listelenir.
    expect(stats.rows[0].thresholds).toEqual([75, 80, 85])
    expect(buildMarginStats([pick(90), pick(91)]).rows[0].thresholds).toEqual([75])
  })

  it('değerlendirilemedi ve bekliyor orana girmez', () => {
    const band = buildMarginStats([pick(76, 'won'), pick(77, 'lost'), pick(78, 'void'), pick(79, 'pending'), pick(75, 'won')]).rows[0].bands[0]
    expect(band).toMatchObject({ won: 2, lost: 1, void: 1, pending: 1, decided: 3, total: 5, rate: 66.7, lowSample: true })
  })

  it('n = 19 az veridir, n = 20 değildir', () => {
    const picks = (count: number) => Array.from({ length: count }, () => pick(76))
    expect(buildMarginStats(picks(19)).rows[0].bands[0]).toMatchObject({ decided: 19, lowSample: true })
    expect(buildMarginStats(picks(20)).rows[0].bands[0]).toMatchObject({ decided: 20, lowSample: false })
  })

  it('"tüm kategoriler" satırı kategori satırlarının toplamıdır; benzersiz maç bir kez sayılır', () => {
    const picks = [
      pick(76, 'won', { matchId: 'ortak' }),
      pick(92, 'lost'),
      pick(81, 'won', { matchId: 'ortak', threshold: 80 }, 'btts'),
      pick(99, 'won', { threshold: 80 }, 'btts'),
      pick(47, 'void', { threshold: 45 }, 'homeWin25'),
    ]
    const stats = buildMarginStats(picks)
    expect(stats.rows.map((r) => r.key)).toEqual(['over25', 'btts', 'homeWin25', 'all'])
    const all = stats.rows[3]
    expect(all.thresholds).toEqual([])
    for (let band = 0; band < MARGIN_BANDS.length; band++) {
      expect(all.bands[band].total).toBe(stats.rows.slice(0, 3).reduce((sum, r) => sum + r.bands[band].total, 0))
      expect(all.bands[band].won).toBe(stats.rows.slice(0, 3).reduce((sum, r) => sum + r.bands[band].won, 0))
    }
    expect(all.bands.map((t) => t.decided)).toEqual([2, 0, 0, 2, 0])
    // Sonuçlanmış 4 öneri, 3 benzersiz maç ("ortak" iki kategoride).
    expect(stats.decidedMatches).toBe(3)
  })

  it('"eşik +5 / +10 olsaydı": eşik üstü puanı en az o kadar olan önerilerin başarısı', () => {
    const picks = [pick(75, 'lost'), pick(79, 'lost'), pick(80, 'won'), pick(84, 'lost'), pick(85, 'won'), pick(99, 'won'), pick(60, 'won', { threshold: 45 }, 'homeWin25')]
    const stats = buildMarginStats(picks)
    expect(stats.raised.map((r) => r.step)).toEqual([5, 10])
    expect(stats.raised[0].tally).toMatchObject({ decided: 5, won: 4, rate: 80 })
    expect(stats.raised[1].tally).toMatchObject({ decided: 3, won: 3, rate: 100 })
    // Bantların toplamıyla aynıdır.
    const all = stats.rows.find((r) => r.key === 'all')!
    expect(stats.raised[0].tally.decided).toBe(all.bands.slice(1).reduce((sum, t) => sum + t.decided, 0))
    expect(stats.raised[1].tally.decided).toBe(all.bands.slice(2).reduce((sum, t) => sum + t.decided, 0))
  })

  it('yüzdesi kayıtlı eşiğinin altında olan (beklenmeyen) öneri tabloya girmez, sayılır', () => {
    const stats = buildMarginStats([pick(70), pick(80)])
    expect(stats.below).toBe(1)
    expect(stats.rows.find((r) => r.key === 'all')!.bands.reduce((sum, t) => sum + t.total, 0)).toBe(1)
  })

  it('öneri yoksa tablo boştur', () => {
    const empty = buildMarginStats([])
    expect(empty.rows).toEqual([])
    expect(empty.below).toBe(0)
    expect(empty.decidedMatches).toBe(0)
    expect(empty.raised.map((r) => r.tally.decided)).toEqual([0, 0])
  })
})
