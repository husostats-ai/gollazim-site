import { describe, expect, it } from 'vitest'
import type { CategoryId } from '../../config/categories'
import type { Match, Pick, PickOutcome } from '../../types'
import { analyzeCategory } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { buildRankStats, pickRanks, RANK_BANDS } from './rankStats'

// Sıra öneri kaydında saklanmaz: günün maç kayıtlarından yeniden hesaplanır ve kayıtlı
// yüzdeyle doğrulanır. Değerler sentetiktir; İlk Yarı 0.5 Üst yüzdesi CSV'deki hazır kolondur.

const DAY = '2026-10-05'
let seq = 0
/** Günün maçları: verilen İY 0.5 Üst yüzdeleriyle, ayrı saatlerde */
const day = (percents: number[], date = DAY, field = 'ht05Pct'): Match[] =>
  percents.map((percent, i) => makeMatch({ [field]: percent }, { id: `r${++seq}`, date, time: `${String(10 + (i % 10)).padStart(2, '0')}:${String(i).padStart(2, '0')}` }))
const pickOf = (match: Match, outcome: PickOutcome = 'won', extra: Partial<Pick> = {}, categoryId: CategoryId = 'ht05'): Pick => ({
  id: `${match.id}|${categoryId}`,
  matchId: match.id,
  categoryId,
  date: match.date,
  percent: Number(match.stats[categoryId === 'ht05' ? 'ht05Pct' : 'sh05Pct']),
  threshold: 80,
  outcome,
  frozenAt: '',
  ...extra,
})
/** 99'dan başlayıp birer azalan yüzdeler */
const descending = (count: number, from = 99) => Array.from({ length: count }, (_, i) => from - i)

describe('sıranın yeniden hesaplanması', () => {
  it('sıra, analizdeki listeyle aynıdır: 1…15; 16. maç listeye girmez', () => {
    const matches = day(descending(20))
    const ranks = pickRanks(matches.map((m) => pickOf(m)), matches)
    expect(matches.slice(0, 15).map((m) => ranks.get(`${m.id}|ht05`))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    // 16–20: eşiği geçer ama ilk 15'te değildir; böyle bir öneri dondurulmaz, kayıt olsa da sırası doğrulanmaz.
    expect(matches.slice(15).map((m) => ranks.get(`${m.id}|ht05`))).toEqual([null, null, null, null, null])
    const live = analyzeCategory(matches, 'ht05', 80).predictions.map((p) => p.match.id)
    expect(live).toEqual(matches.slice(0, 15).map((m) => m.id))
  })

  it('skoru girilmemiş (önerisi dondurulmamış) maçlar sırayı doldurur: sıra dondurulmuşlar arasında yeniden numaralanmaz', () => {
    const matches = day(descending(12))
    const ranks = pickRanks([pickOf(matches[2]), pickOf(matches[10])], matches)
    expect(ranks.get(`${matches[2].id}|ht05`)).toBe(3)
    expect(ranks.get(`${matches[10].id}|ht05`)).toBe(11)
  })

  it('eşit yüzdede analizdeki kural geçerlidir: erken başlayan maç önde', () => {
    const late = makeMatch({ ht05Pct: 90 }, { id: 'a-gec', date: DAY, time: '21:00' })
    const early = makeMatch({ ht05Pct: 90 }, { id: 'z-erken', date: DAY, time: '15:00' })
    const top = makeMatch({ ht05Pct: 95 }, { id: 'ust', date: DAY, time: '23:00' })
    const ranks = pickRanks([pickOf(late), pickOf(early), pickOf(top)], [late, early, top])
    expect([ranks.get('ust|ht05'), ranks.get('z-erken|ht05'), ranks.get('a-gec|ht05')]).toEqual([1, 2, 3])
  })

  it('her gün ve her kategori kendi içinde sıralanır', () => {
    const first = day([95, 90])
    const second = day([85, 99], '2026-10-06')
    const other = makeMatch({ ht05Pct: 70, sh05Pct: 97 }, { id: 'iki-yari', date: DAY, time: '12:00' })
    const picks = [...first, ...second].map((m) => pickOf(m))
    const ranks = pickRanks([...picks, pickOf(other, 'won', {}, 'sh05')], [...first, ...second, other])
    expect(first.map((m) => ranks.get(`${m.id}|ht05`))).toEqual([1, 2])
    expect(second.map((m) => ranks.get(`${m.id}|ht05`))).toEqual([2, 1])
    expect(ranks.get('iki-yari|sh05')).toBe(1)
  })

  it('aynı gün ve kategoride farklı eşikle dondurulmuş öneriler kendi eşiğinin listesinde sıralanır', () => {
    const matches = day([95, 88, 84])
    // Eşik 80 iken üçü de listede (sıra 3); eşik 90 iken yalnızca ilki listede.
    const ranks = pickRanks([pickOf(matches[2], 'won', { threshold: 80 }), pickOf(matches[0], 'won', { threshold: 90 })], matches)
    expect(ranks.get(`${matches[2].id}|ht05`)).toBe(3)
    expect(ranks.get(`${matches[0].id}|ht05`)).toBe(1)
    // Kayıtlı eşiğiyle listeye giremeyen öneri doğrulanmaz.
    expect(pickRanks([pickOf(matches[1], 'won', { threshold: 90 })], matches).get(`${matches[1].id}|ht05`)).toBeNull()
  })
})

describe('sırası doğrulanamayan öneriler', () => {
  const matches = day(descending(6))
  const picks = matches.map((m) => pickOf(m))

  it('maç kaydı silinmişse sıra yoktur; kalanların sırası yeniden hesaptaki yeridir', () => {
    const ranks = pickRanks(picks, matches.slice(1))
    expect(ranks.get(picks[0].id)).toBeNull()
    expect(ranks.get(picks[1].id)).toBe(1)
  })

  it('maç sonradan düzenlenmişse (yüzde kayıtlı yüzdeden farklı) sıra yoktur', () => {
    const edited = matches.map((m, i) => (i === 1 ? { ...m, stats: { ...m.stats, ht05Pct: 97.4 } } : m))
    const ranks = pickRanks(picks, edited)
    expect(ranks.get(picks[1].id)).toBeNull()
    expect(ranks.get(picks[0].id)).toBe(1)
  })

  it('öneri yeniden hesapta listede çıkmıyorsa (yüzdesi eşiğin altına düşmüş) sıra yoktur', () => {
    const edited = matches.map((m, i) => (i === 5 ? { ...m, stats: { ...m.stats, ht05Pct: 40 } } : m))
    expect(pickRanks(picks, edited).get(picks[5].id)).toBeNull()
  })

  it('doğrulanamayanlar hiçbir banda girmez ve sayılır', () => {
    const stats = buildRankStats(picks, matches.slice(2))
    expect(stats.verified).toBe(4)
    expect(stats.unverified).toBe(2)
    expect(stats.rows.find((r) => r.key === 'all')!.bands.map((t) => t.total)).toEqual([4, 0, 0])
  })

  it('günün maç kayıtları hiç yoksa tablo boştur, öneriler doğrulanamayan sayılır', () => {
    expect(buildRankStats(picks, [])).toEqual({ rows: [], verified: 0, unverified: 6, decidedMatches: 0 })
    expect(buildRankStats([], matches)).toEqual({ rows: [], verified: 0, unverified: 0, decidedMatches: 0 })
  })
})

describe('sıra bantları', () => {
  it('bantlar 1–5 / 6–10 / 11–15; sınırlar: 5 ve 6, 10 ve 11, 15', () => {
    expect(RANK_BANDS.map((b) => b.label)).toEqual(['1–5', '6–10', '11–15'])
    const matches = day(descending(15))
    const only = (index: number) => buildRankStats([pickOf(matches[index])], matches).rows[0].bands.map((t) => t.total)
    expect(only(0)).toEqual([1, 0, 0])
    expect(only(4)).toEqual([1, 0, 0])
    expect(only(5)).toEqual([0, 1, 0])
    expect(only(9)).toEqual([0, 1, 0])
    expect(only(10)).toEqual([0, 0, 1])
    expect(only(14)).toEqual([0, 0, 1])
  })

  it('değerlendirilemedi ve bekliyor orana girmez', () => {
    const matches = day(descending(5))
    const outcomes: PickOutcome[] = ['won', 'lost', 'void', 'pending', 'won']
    const band = buildRankStats(matches.map((m, i) => pickOf(m, outcomes[i])), matches).rows[0].bands[0]
    expect(band).toMatchObject({ won: 2, lost: 1, void: 1, pending: 1, decided: 3, total: 5, rate: 66.7, lowSample: true })
  })

  it('"tüm kategoriler" satırı kategori satırlarının toplamıdır; benzersiz maç bir kez sayılır', () => {
    // Aynı 12 maç iki kategoride de önerilmiş.
    const matches = descending(12).map((percent, i) => makeMatch({ ht05Pct: percent, sh05Pct: percent - 1 }, { id: `cift${i}`, date: DAY, time: `1${i % 10}:0${i % 6}` }))
    const picks = matches.flatMap((m, i) => [pickOf(m, i % 3 === 0 ? 'lost' : 'won'), pickOf(m, i % 2 === 0 ? 'won' : 'lost', {}, 'sh05')])
    const stats = buildRankStats(picks, matches)
    expect(stats.rows.map((r) => r.key)).toEqual(['ht05', 'sh05', 'all'])
    const [ht, sh, all] = stats.rows
    for (let band = 0; band < RANK_BANDS.length; band++) {
      expect(all.bands[band].decided).toBe(ht.bands[band].decided + sh.bands[band].decided)
      expect(all.bands[band].won).toBe(ht.bands[band].won + sh.bands[band].won)
    }
    expect(all.bands.map((t) => t.decided)).toEqual([10, 10, 4])
    expect(stats.decidedMatches).toBe(12)
    expect(stats.verified).toBe(24)
  })

  it('n = 19 az veridir, n = 20 değildir', () => {
    // Dört günde 5'er maç: hepsi 1–5 bandında.
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((date) => day(descending(5), date))
    const all = days.flat()
    const twenty = buildRankStats(all.map((m) => pickOf(m)), all).rows[0].bands[0]
    expect([twenty.decided, twenty.lowSample]).toEqual([20, false])
    const nineteen = buildRankStats(all.map((m, i) => pickOf(m, i === 0 ? 'void' : 'won')), all).rows[0].bands[0]
    expect([nineteen.decided, nineteen.lowSample]).toEqual([19, true])
  })
})
