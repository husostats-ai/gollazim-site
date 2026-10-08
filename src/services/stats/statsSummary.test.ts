import { describe, expect, it } from 'vitest'
import { CATEGORIES, defaultThresholds, type CategoryId } from '../../config/categories'
import type { AiVerdict, Match, Pick, PickOutcome } from '../../types'
import { formatRate } from '../../utils/format'
import { buildLegacyAiStats } from '../ai/aiStats'
import { analyzeCategory } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { recordShare, sharedPicksOnly } from '../story/shared'
import { backfillMarket, buildMarketStats } from './marketStats'
import { buildStarStats, recomputedNote, recomputeStars, starsOf } from './starStats'
import { buildStats } from './statsEngine'
import { buildPicksForResult } from '../results/freeze'
import { isBackupFile } from '../data/backupFormat'
import type { BackupFile, MatchResult } from '../../types'
import {
  AI_GUIDE,
  buildDetailCsv,
  buildDetailRows,
  buildStatsSummary,
  DETAIL_CSV_COLUMNS,
  frozenStars,
  NO_DATA_TEXT,
  rateCell,
  scopeBounds,
  type SummaryInput,
  type SummaryScope,
} from './statsSummary'

const TODAY = '2026-10-10'
const NOW = new Date('2026-10-10T09:30:00.000Z') // 12:30 Türkiye
let n = 0
const pick = (outcome: PickOutcome, categoryId: CategoryId, date: string, extra: Partial<Pick> = {}): Pick => ({
  id: `p${++n}`,
  matchId: `m${n}`,
  categoryId,
  date,
  percent: 90,
  threshold: 75,
  outcome,
  frozenAt: '',
  reliability: 'low',
  ...extra,
})
const many = (count: number, outcome: PickOutcome, categoryId: CategoryId, date: string, extra: Partial<Pick> = {}) =>
  Array.from({ length: count }, () => pick(outcome, categoryId, date, extra))

const picks: Pick[] = [
  // 2.5 Üst: 21 sonuçlanmış (az veri değil); model ve piyasa kayıtlı
  ...many(12, 'won', 'over25', '2026-10-09', { secondPercent: 60, conflict: true, marketPercent: 62, marketConflict: true }),
  ...many(9, 'lost', 'over25', '2026-10-09', { secondPercent: 80, conflict: false, marketPercent: 80, marketConflict: false, reliability: 'high' }),
  // KG Var: az veri
  ...many(2, 'won', 'btts', '2026-10-08', { reliability: 'medium', percent: 82 }),
  ...many(1, 'lost', 'btts', '2026-10-08', { reliability: 'medium', percent: 82 }),
  // Korner: değerlendirilemedi
  ...many(4, 'void', 'corners95', '2026-10-08', { reliability: 'unmeasured' }),
  ...many(1, 'void', 'cards35', '2026-10-08', { reliability: 'unmeasured' }),
  // Taraf & Gol
  ...many(2, 'won', 'homeWin15', '2026-10-05', { reliability: 'market', percent: 60, conflict: false }),
  ...many(2, 'lost', 'homeWin15', '2026-10-05', { reliability: 'market', percent: 60, conflict: true }),
  // Kapsam dışı eski öneriler
  ...many(3, 'won', 'ht05', '2026-09-01'),
  pick('pending', 'ht05', '2026-10-09'),
]
const matches: Match[] = picks.map((p, i) =>
  makeMatch(i % 2 === 0 ? { oddsHome: 1.5, oddsDraw: 4, oddsAway: 6, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 1.4, awayXg: 1.1 } : {}, {
    id: p.matchId,
    date: p.date,
    home: `Ev ${i}`,
    away: `Dep ${i}`,
    league: 'England · EFL Trophy',
  }),
)
const verdict = (matchId: string, provider: AiVerdict['provider'], decision: AiVerdict['decision'], date: string): AiVerdict => ({
  id: `${matchId}|${provider}`,
  matchId,
  date,
  provider,
  decision,
  reason: 'gizli gerekçe metni',
  risk: 'gizli risk metni',
  savedAt: '',
})
const verdicts = [
  verdict(picks[0].matchId, 'chatgpt', 'strong', '2026-10-09'),
  verdict(picks[0].matchId, 'gemini', 'strong', '2026-10-09'),
  verdict(picks[12].matchId, 'chatgpt', 'reject', '2026-10-09'),
]
const shared = recordShare([], {
  date: '2026-10-09',
  categoryId: 'over25',
  matches: [picks[0], picks[1], picks[12]].map((p) => ({ id: p.matchId, date: p.date, time: '20:00' })),
  now: '2026-10-09T09:00:00.000Z',
})
const input = (scope: SummaryScope = { kind: 'all' }, extra: Partial<SummaryInput> = {}): SummaryInput => ({
  now: NOW,
  today: TODAY,
  scope,
  includeGuide: true,
  picks,
  matches,
  verdicts,
  shared,
  thresholds: defaultThresholds(),
  marketConflictLimit: 25,
  ...extra,
})
/** Markdown tablosundan, ilk hücresi verilen satır */
const row = (text: string, first: string): string[] => {
  const line = text.split('\n').find((l) => l.startsWith(`| ${first} |`))
  if (!line) throw new Error(`satır yok: ${first}`)
  return line.split('|').slice(1, -1).map((c) => c.trim())
}
const section = (text: string, title: string): string => {
  const start = text.indexOf(`## ${title}`)
  if (start < 0) throw new Error(`bölüm yok: ${title}`)
  const end = text.indexOf('\n## ', start + 1)
  return text.slice(start, end < 0 ? undefined : end)
}

describe('kapsam seçici', () => {
  it('sınırlar: son 7 / 30 gün bugünü de sayar; aralık ters girilirse düzeltilir', () => {
    expect(scopeBounds({ kind: 'all' }, TODAY)).toEqual({ from: null, to: null })
    expect(scopeBounds({ kind: 'last7' }, TODAY)).toEqual({ from: '2026-10-04', to: '2026-10-10' })
    expect(scopeBounds({ kind: 'last30' }, TODAY)).toEqual({ from: '2026-09-11', to: '2026-10-10' })
    expect(scopeBounds({ kind: 'range', from: '2026-10-08', to: '2026-10-09' }, TODAY)).toEqual({ from: '2026-10-08', to: '2026-10-09' })
    expect(scopeBounds({ kind: 'range', from: '2026-10-09', to: '2026-10-08' }, TODAY)).toEqual({ from: '2026-10-08', to: '2026-10-09' })
  })

  it.each([
    ['all', { kind: 'all' }, () => true],
    ['last7', { kind: 'last7' }, (d: string) => d >= '2026-10-04'],
    ['last30', { kind: 'last30' }, (d: string) => d >= '2026-09-11'],
    ['range', { kind: 'range', from: '2026-10-08', to: '2026-10-09' }, (d: string) => d >= '2026-10-08' && d <= '2026-10-09'],
  ] as [string, SummaryScope, (d: string) => boolean][])('%s: özet yalnızca kapsamdaki önerileri sayar', (_, scope, keep) => {
    const text = buildStatsSummary(input(scope))
    const expected = buildStats(picks.filter((p) => keep(p.date)))
    expect(text).toContain(`- Dondurulmuş öneri: ${expected.overall.total}`)
    expect(text).toContain(`- Sonuçlanmış öneri (tuttu + tutmadı): ${expected.overall.decided} (tutan ${expected.overall.won}, tutmayan ${expected.overall.lost})`)
    expect(text).toContain(`- Genel başarı: ${formatRate(expected.overall.rate)}`)
    expect(text).toContain(`- Benzersiz maç: ${expected.matches.total} `)
  })

  it('son 7 günde eski kategori görünmez', () => {
    expect(section(buildStatsSummary(input({ kind: 'all' })), 'Kategori başarısı')).toContain('| İLK YARI 0.5 ÜST |')
    expect(section(buildStatsSummary(input({ kind: 'range', from: '2026-10-08', to: '2026-10-08' })), 'Kategori başarısı')).not.toContain('| İLK YARI 0.5 ÜST |')
  })
})

describe('özet metni', () => {
  const text = buildStatsSummary(input())
  const stats = buildStats(picks)

  it('başlık ve kapsam bilgileri', () => {
    expect(text).toContain('- Oluşturulma: 10 Eki 2026 12:30 (Europe/Istanbul)')
    expect(text).toContain('- Kapsam: Tümü')
    expect(text).toContain('- Veri olan günler: 4 (1 Eyl 2026 – 9 Eki 2026)')
    expect(text).toContain(`- Değerlendirilemedi: ${stats.overall.void}`)
    expect(buildStatsSummary(input({ kind: 'last7' }))).toContain('- Kapsam: Son 7 gün (4 Eki 2026 – 10 Eki 2026)')
  })

  it('güncel eşikler ve dondurma notu', () => {
    const thresholds = { ...defaultThresholds(), over25: 82 }
    const custom = buildStatsSummary(input({ kind: 'all' }, { thresholds }))
    expect(row(section(custom, 'Güncel eşikler'), '2.5 ÜST')).toEqual(['2.5 ÜST', '%82'])
    expect(section(custom, 'Güncel eşikler').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Kategori') && !l.startsWith('| ---'))).toHaveLength(CATEGORIES.length)
    expect(custom).toContain('Öneriler, dondurulduğu andaki eşiklerle kaydedilir.')
  })

  it('kategori tablosu istatistik motoruyla aynı sayıları ve yuvarlamayı kullanır', () => {
    const body = section(text, 'Kategori başarısı')
    for (const bucket of stats.byCategory) {
      const t = bucket.tally
      const cells = row(body, CATEGORIES.find((c) => c.id === bucket.key)!.label)
      expect(cells.slice(1)).toEqual([String(t.decided), String(t.won), formatRate(t.rate), t.decided > 0 && t.lowSample ? 'az veri' : '', String(t.void), String(t.pending)])
    }
    // 12/21 = %57,1 (bir ondalık, sitedeki biçim)
    expect(row(body, '2.5 ÜST')).toEqual(['2.5 ÜST', '21', '12', '%57,1', '', '0', '0'])
  })

  it('"az veri" işareti: 20\'den az sonuçlanmış öneride çıkar; sonuçlanmış öneri yoksa çıkmaz', () => {
    const body = section(text, 'Kategori başarısı')
    expect(row(body, 'KG VAR')[4]).toBe('az veri')
    expect(row(body, '2.5 ÜST')[4]).toBe('')
    expect(row(body, 'KORNER 9.5 ÜST').slice(1)).toEqual(['0', '0', '—', '', '4', '0'])
  })

  it('güvenilirlik ve yıldız tabloları', () => {
    const reliability = section(text, 'Veri güvenilirliğine göre başarı')
    const low = stats.byReliability.find((b) => b.key === 'low')!.tally
    expect(row(reliability, 'Düşük').slice(1, 4)).toEqual([String(low.decided), String(low.won), formatRate(low.rate)])
    expect(row(reliability, 'Yüksek').slice(1, 4)).toEqual(['9', '0', '%0'])

    // 2.5 Üst %90: düşük güvenilirlikte en çok 3 yıldız; yüksek güvenilirlikte 5
    expect(frozenStars(picks[0])).toBe(3)
    expect(frozenStars(picks[12])).toBe(5)
    // Model çelişkisi yüksek güvenilirlikte yıldızı 3'e sınırlar
    expect(frozenStars({ ...picks[12], conflict: true })).toBe(3)
    // Taraf & Gol ve güvenilirliği kayıtlı olmayan öneri: bulunamaz
    expect(frozenStars(picks.find((p) => p.categoryId === 'homeWin15')!)).toBeNull()
    expect(frozenStars({ ...picks[0], reliability: undefined })).toBeNull()
    const stars = section(text, 'Yıldız sayısına göre başarı')
    expect(row(stars, '5 yıldız').slice(1, 4)).toEqual(['9', '0', '%0'])
    expect(row(stars, '2.5 ÜST')).toEqual(['2.5 ÜST', '%0 · n=9', '— · n=0', '%100 · n=12', '— · n=0', '— · n=0'])
    expect(stars).toContain('4 eski öneride (Taraf & Gol ya da güvenilirliği kayıtlı olmayan) yıldız bulunamadığı için')
    // Bu test verisinde hiçbir öneride kayıtlı yıldız yok: hepsi yeniden hesaplanır
    expect(stars).toContain(`${picks.length - 4} öneri yeniden hesaplandı (eski kayıt)`)
  })

  it('yıldız, analizin ürettiği yıldızla aynıdır', () => {
    const live = [
      makeMatch({ over25Pct: 92, homeXg: 1.6, awayXg: 1.5, bttsPct: 85, ht05Pct: 81, corners95Pct: 74 }),
      makeMatch({ over25Pct: 78, homeXg: 0.4, awayXg: 0.3, bttsPct: 99, ht05Pct: 95, corners95Pct: 90 }),
    ]
    for (const id of ['over25', 'btts', 'ht05', 'corners95'] as const) {
      for (const p of analyzeCategory(live, id, 0).predictions) {
        const frozen = { ...pick('won', id, TODAY), percent: p.percent, reliability: p.reliability.level, conflict: p.conflict }
        expect(frozenStars(frozen), `${id} %${p.percent}`).toBe(p.stars)
      }
    }
  })

  it('günlük sonuçlar', () => {
    const daily = section(text, 'Günlük sonuçlar')
    const day = stats.daily.find((b) => b.key === '2026-10-09')!.tally
    expect(row(daily, '9 Eki 2026')).toEqual(['9 Eki 2026', formatRate(day.rate), String(day.decided), String(day.won), String(day.total)])
  })

  it('en fazla son 14 gün yazılır', () => {
    const longRun = Array.from({ length: 20 }, (_, i) => pick('won', 'over25', `2026-09-${String(i + 1).padStart(2, '0')}`))
    const daily = section(buildStatsSummary(input({ kind: 'all' }, { picks: longRun })), 'Günlük sonuçlar')
    expect(daily).toContain('(son 14 gün)')
    expect(daily.split('\n').filter((l) => /^\| \d/.test(l))).toHaveLength(14)
    expect(daily).not.toContain('| 6 Eyl 2026 |')
    expect(daily).toContain('| 7 Eyl 2026 |')
  })

  it('kalibrasyon tabloları sayfadakilerle aynı fonksiyonlardan gelir', () => {
    const model = stats.goalModel!
    const all = model.calibration.find((r) => r.key === 'all')!
    expect(row(section(text, 'Kalibrasyon: hazır yüzde ve gol modeli'), 'Dört kategori birlikte').slice(1, 4)).toEqual([formatRate(all.ready), formatRate(all.model), rateCell(all.tally)])
    expect(row(section(text, 'Kalibrasyon: hazır yüzde ve gol modeli'), 'Çelişkili')).toEqual(['Çelişkili', '%100 · n=12'])

    const market = buildMarketStats(backfillMarket(picks, matches, 25))!
    const over25 = market.rows.find((r) => r.key === 'over25')!
    expect(row(section(text, 'Kalibrasyon: hazır yüzde ve piyasa'), '2.5 ÜST')).toEqual([
      '2.5 ÜST',
      formatRate(over25.ready),
      formatRate(over25.market),
      rateCell(over25.tally),
      rateCell(over25.clear),
      rateCell(over25.conflict),
      String(over25.noOdds),
    ])
    expect(text).toContain(`${market.backfilled} önerinin piyasa yüzdesi dondurma anında kayıtlı değildi`)

    const side = stats.sideGoals!.calibration.find((r) => r.key === 'all')!
    expect(row(section(text, 'Kalibrasyon: Taraf & Gol'), 'Tüm Taraf & Gol')).toEqual(['Tüm Taraf & Gol', '%60', rateCell(side.tally), '-10 puan'])
  })

  it('yapay zekâ kararları: eski maç geneli kararlar kendi bölümünde; kaynak ve karar bazında, her hücrede n', () => {
    const ai = buildLegacyAiStats(picks, verdicts)!
    const body = section(text, 'Yapay zekâ kararlarının başarısı: maç geneli kararlar (eski)')
    expect(row(body, 'ChatGPT')).toEqual(['ChatGPT', '2', rateCell(ai.approved.chatgpt)])
    expect(row(body, 'Claude')).toEqual(['Claude', '0', '— · n=0'])
    expect(row(body, 'Çoğunluk kararı')).toEqual(['Çoğunluk kararı', '1', '%100 · n=1'])
    expect(row(body, 'Eleme')).toEqual(['Eleme', '%0 · n=1', '— · n=0', '— · n=0', '— · n=0'])
    // Bu veride kategori bazlı karar yok: o bölüm boş, eski kararlar oraya karışmıyor.
    expect(section(text, 'Yapay zekâ kararlarının başarısı: kategori bazlı kararlar')).toContain('Kayıtlı kategori bazlı yapay zekâ kararı yok.')
    const none = buildStatsSummary(input({ kind: 'all' }, { verdicts: [] }))
    expect(none).toContain('Kayıtlı kategori bazlı yapay zekâ kararı yok.')
    expect(none).toContain('Kayıtlı maç geneli (eski) yapay zekâ kararı yok.')
  })

  it('kategori bazlı kararlar ayrı bölümde ölçülür ve eski bölümü değiştirmez', () => {
    // picks[0] ve picks[1]: 2.5 ÜST, tuttu. picks[12]: 2.5 ÜST, tutmadı.
    const fresh = (matchId: string, provider: AiVerdict['provider'], decision: NonNullable<AiVerdict['decision']>): AiVerdict => ({ id: `${matchId}|${provider}`, matchId, date: '2026-10-09', provider, byCategory: { over25: decision }, asked: ['over25'], reason: 'gizli gerekçe metni', risk: 'gizli risk metni', savedAt: '' })
    const category = [
      ...(['chatgpt', 'gemini', 'claude'] as const).map((p) => fresh(picks[1].matchId, p, 'medium')),
      fresh(picks[13].matchId, 'chatgpt', 'strong'),
      fresh(picks[13].matchId, 'gemini', 'weak'),
      fresh(picks[13].matchId, 'claude', 'strong'),
    ]
    const mixed = buildStatsSummary(input({ kind: 'all' }, { verdicts: [...verdicts, ...category] }))
    const body = section(mixed, 'Yapay zekâ kararlarının başarısı: kategori bazlı kararlar')
    expect(row(body, 'ChatGPT')).toEqual(['ChatGPT', '2', '%50 · n=2'])
    expect(row(body, 'Gemini')).toEqual(['Gemini', '2', '%100 · n=1'])
    expect(row(body, 'Çoğunluk kararı')).toEqual(['Çoğunluk kararı', '2', '%50 · n=2'])
    expect(row(body, 'Orta')).toEqual(['Orta', '%100 · n=1', '%100 · n=1', '%100 · n=1', '%100 · n=1'])
    expect(body).toContain('Karar yalnızca şu kategoriler için alınır: 2.5 ÜST, İLK YARI 0.5 ÜST, KG VAR, 2.5 ÜST & KG VAR.')
    // Eski bölüm, kategori kararları eklenince değişmez.
    const legacyTitle = 'Yapay zekâ kararlarının başarısı: maç geneli kararlar (eski)'
    expect(section(mixed, legacyTitle)).toBe(section(text, legacyTitle))
  })

  it('ayrıntı CSV\'si: üç yapay zekâ sütunu; yeni kararlarda hücre önerinin kendi kategorisinin kararıdır', () => {
    expect(DETAIL_CSV_COLUMNS.filter((c) => c.startsWith('ai_'))).toEqual(['ai_chatgpt', 'ai_gemini', 'ai_claude', 'ai_chatgpt_skor', 'ai_gemini_skor', 'ai_claude_skor'])
    const col = (name: (typeof DETAIL_CSV_COLUMNS)[number]) => DETAIL_CSV_COLUMNS.indexOf(name)
    // Aynı maçın iki kategoride önerisi var: 2.5 ÜST ve 2. YARI 0.5 ÜST (karar istenmeyen kategori).
    const extra = { ...picks[1], id: 'ek-oneri', categoryId: 'sh05' as const }
    const fresh: AiVerdict[] = (['chatgpt', 'gemini', 'claude'] as const).map((provider, i) => ({ id: `${picks[1].matchId}|${provider}`, matchId: picks[1].matchId, date: '2026-10-09', provider, byCategory: i === 2 ? {} : { over25: i === 0 ? 'strong' : 'weak' }, asked: ['over25'], reason: 'r', risk: 'k', savedAt: '' }))
    const rows = buildDetailRows(input({ kind: 'all' }, { picks: [...picks, extra], verdicts: [...verdicts, ...fresh] })).filter((r) => r[col('ev_sahibi')] === 'Ev 1')
    const cells = (kategori: string) => { const r = rows.find((x) => x[col('kategori')] === kategori)!; return [r[col('ai_chatgpt')], r[col('ai_gemini')], r[col('ai_claude')]] }
    expect(cells('2.5 ÜST')).toEqual(['Güçlü', 'Zayıf', '']) // Claude bu kategoride cevapsız
    expect(cells('2. YARI 0.5 ÜST')).toEqual(['', '', '']) // karar istenmeyen kategori: boş
    // Eski maç geneli karar, maçın her satırında eskisi gibi yazılır.
    const old = buildDetailRows(input()).find((r) => r[col('ev_sahibi')] === 'Ev 0')!
    expect([old[col('ai_chatgpt')], old[col('ai_gemini')], old[col('ai_claude')]]).toEqual(['Güçlü', 'Güçlü', ''])
  })

  it('paylaşılan ve tüm öneriler yan yana', () => {
    const sharedStats = buildStats(sharedPicksOnly(picks, shared))
    const body = section(text, 'Paylaşılan ve tüm öneriler')
    expect(row(body, '2.5 ÜST')).toEqual(['2.5 ÜST', '%57,1 · n=21', '%66,7 · n=3'])
    expect(row(body, 'KG VAR')[2]).toBe('— · n=0')
    expect(row(body, 'Genel')).toEqual(['Genel', rateCell(stats.overall), rateCell(sharedStats.overall)])
  })

  it('veri kısıtları', () => {
    const body = section(text, 'Veri kısıtları')
    expect(body).toContain('- Korner sayısı girilmediği için değerlendirilemeyen korner önerisi: 4')
    expect(body).toContain('- Kart sayısı girilmediği için değerlendirilemeyen kart önerisi: 1')
    expect(body).toContain('- Diğer kategorilerde değerlendirilemeyen öneri: 0')
    expect(body).toContain(`- Maç kaydı duran maç: ${picks.length} / ${picks.length}`)
    const withoutOdds = matches.filter((m) => m.stats.oddsHome === undefined).length
    expect(body).toContain(`- Bunlardan 1X2 oranı eksik: ${withoutOdds}`)
    expect(body).toContain(`- Maç öncesi xG eksik: ${withoutOdds}`)
    // Maç kaydı silinmişse
    expect(buildStatsSummary(input({ kind: 'all' }, { matches: matches.slice(0, 10) }))).toContain(`- Maç kaydı duran maç: 10 / ${picks.length}`)
  })

  it('yönerge açıkken en üsttedir; kapalıyken hiç yoktur', () => {
    expect(text.startsWith(AI_GUIDE)).toBe(true)
    const without = buildStatsSummary(input({ kind: 'all' }, { includeGuide: false }))
    expect(without.startsWith('# GOL LAZIM istatistik özeti')).toBe(true)
    expect(without).not.toContain('Görevin:')
    expect(text.slice(AI_GUIDE.length).trimStart()).toBe(without)
  })

  it('kişisel veri, karar gerekçesi, maç kimliği ya da takım adı içermez', () => {
    expect(text).not.toMatch(/@|gizli|https?:|\bm\d+\b|Ev \d|EFL/)
  })

  it('veri yoksa kısa özet', () => {
    const empty = buildStatsSummary(input({ kind: 'all' }, { picks: [], includeGuide: false }))
    expect(empty).toContain(`${NO_DATA_TEXT}.`)
    expect(empty).not.toContain('## ')
    // Yalnızca değerlendirilemeyen öneri varsa da
    const onlyVoid = buildStatsSummary(input({ kind: 'range', from: '2026-10-08', to: '2026-10-08' }, { picks: picks.filter((p) => p.outcome === 'void') }))
    expect(onlyVoid).toContain('- Dondurulmuş öneri: 5')
    expect(onlyVoid).toContain(`${NO_DATA_TEXT}.`)
    // Kapsamda veri olmayan aralık
    expect(buildStatsSummary(input({ kind: 'range', from: '2026-01-01', to: '2026-01-02' }))).toContain(`${NO_DATA_TEXT}.`)
  })
})

describe('ayrıntılı maç tablosu (CSV)', () => {
  it('skoru girilmiş her öneri için bir satır; bekleyenler girmez', () => {
    const rows = buildDetailRows(input())
    expect(rows).toHaveLength(picks.filter((p) => p.outcome !== 'pending').length)
    expect(buildDetailRows(input({ kind: 'last7' }))).toHaveLength(picks.filter((p) => p.outcome !== 'pending' && p.date >= '2026-10-04').length)
    expect(new Set(rows.map((r) => r[DETAIL_CSV_COLUMNS.indexOf('sonuc')]))).toEqual(new Set(['tuttu', 'tutmadı', 'değerlendirilemedi']))
    expect(rows.every((r) => r.length === DETAIL_CSV_COLUMNS.length)).toBe(true)
  })

  it('alanlar kayıtlardan gelir; kayıtta olmayan boş kalır', () => {
    const rows = buildDetailRows(input())
    const col = (name: (typeof DETAIL_CSV_COLUMNS)[number]) => DETAIL_CSV_COLUMNS.indexOf(name)
    const first = rows.find((r) => r[col('ev_sahibi')] === 'Ev 0')!
    expect(first).toEqual(['2026-10-09', '2.5 ÜST', 'Ev 0', 'Dep 0', 'England · EFL Trophy', '90', '60', '62', '3', 'Düşük', 'Güçlü', 'Güçlü', '', 'evet', 'tuttu', '', '', '', '', ''])
    const side = rows.find((r) => r[col('kategori')] === 'EV KAZANIR & 1.5 ÜST')!
    expect(side[col('yildiz')]).toBe('')
    expect(side[col('piyasa_yuzde')]).toBe('')
    expect(side[col('ai_chatgpt')]).toBe('')
    expect(side[col('paylasildi')]).toBe('hayır')
    // Piyasa yüzdesi kayıtlı değilse maç kaydındaki oranlardan gelir; oran yoksa boş kalır
    const btts = rows.filter((r) => r[col('kategori')] === 'KG VAR')
    expect(btts.every((r) => r[col('piyasa_yuzde')] === '')).toBe(true)
    // Maç kaydı silinmişse takım adları boş
    const orphan = buildDetailRows(input({ kind: 'all' }, { matches: [] }))
    expect(orphan[0].slice(2, 5)).toEqual(['', '', ''])
  })

  it('CSV metni: başlık + satırlar', () => {
    const csv = buildDetailCsv(input())
    const lines = csv.split(/\r?\n/)
    expect(lines[0]).toBe(DETAIL_CSV_COLUMNS.join(','))
    expect(lines).toHaveLength(1 + picks.filter((p) => p.outcome !== 'pending').length)
  })
})

describe('yıldız dondurma anında kaydedilir', () => {
  const NOW_ISO = '2026-10-05T21:00:00Z'
  const result: MatchResult = {
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
    updatedAt: NOW_ISO,
  }
  const freeze = (match: Match, dayMatches = [match]) =>
    buildPicksForResult({ match, dayMatches, thresholds: defaultThresholds(), result, existing: [], now: NOW_ISO })

  it('her öneriye o an kartta görünen yıldız yazılır', () => {
    // 2.5 Üst %92, KG Var %85, İY 0.5 %81, Korner 9.5 %74, kart ort. 6
    const match = makeMatch({ over25Pct: 92, bttsPct: 85, ht05Pct: 81, corners95Pct: 74, avgCards: 6, homeXg: 1.6, awayXg: 1.5 })
    const frozen = freeze(match)
    expect(frozen.length).toBeGreaterThanOrEqual(5)
    for (const p of frozen) {
      const live = analyzeCategory([match], p.categoryId, 0).predictions[0]
      expect(p.stars, p.categoryId).toBe(live.stars)
      expect(p.stars).toBeGreaterThanOrEqual(1)
      expect(p.stars).toBeLessThanOrEqual(5)
      // Taraf & Gol dışında sapma alanı yoktur
      if (!p.categoryId.includes('Win')) expect('modelDrift' in p).toBe(false)
    }
  })

  it('Taraf & Gol: yıldız ve "model piyasadan sapıyor" bilgisi kaydedilir; oran yoksa sapma "none"', () => {
    const priced = makeMatch({ oddsHome: 1.4, oddsDraw: 5, oddsAway: 8, oddsOver25: 1.6, oddsUnder25: 2.3, homeXg: 1.9, awayXg: 0.8 })
    const side = freeze(priced).find((p) => p.categoryId === 'homeWin15')!
    const live = analyzeCategory([priced], 'homeWin15', 0).predictions[0]
    expect(side.stars).toBe(live.stars)
    expect(typeof side.modelDrift).toBe('boolean')
    expect(side.modelDrift).toBe(live.notes.some((n) => n.kind === 'model-drift'))

    // Oran yok: yüzde xG'den gelir, sapma ölçülemez
    const xgOnly = makeMatch({ homeXg: 2.6, awayXg: 0.5 })
    const fallback = freeze(xgOnly).find((p) => p.categoryId === 'homeWin15')!
    expect(fallback).toBeDefined()
    expect(fallback.modelDrift).toBe('none')
    expect(fallback.stars).toBe(analyzeCategory([xgOnly], 'homeWin15', 0).predictions[0].stars)
  })

  it('skor düzeltilince kayıtlı yıldız değişmez', () => {
    const match = makeMatch({ over25Pct: 92 })
    const existing = freeze(match)
    const again = buildPicksForResult({
      match: { ...match, stats: { over25Pct: 76 } },
      dayMatches: [match],
      thresholds: defaultThresholds(),
      result: { ...result, ftHome: 0, ftAway: 0 },
      existing,
      now: NOW_ISO,
    })
    expect(again[0]).toMatchObject({ stars: existing[0].stars, percent: 92, outcome: 'lost' })
  })
})

describe('yıldız istatistiği: kayıtlı değer ve eski kayıt', () => {
  it('kayıtlı yıldız varsa o kullanılır; yoksa yeniden hesaplanır ve sayılır', () => {
    // Yeniden hesap 3 verirdi; kayıtta 2 var (ör. dondurma anında başka bir sınır geçerliydi)
    const stored = pick('won', 'over25', TODAY, { stars: 2 })
    const legacy = pick('lost', 'over25', TODAY)
    expect(recomputeStars(stored)).toBe(3)
    expect(starsOf(stored)).toEqual({ stars: 2, source: 'stored' })
    expect(starsOf(legacy)).toEqual({ stars: 3, source: 'recomputed' })
    const stats = buildStarStats([stored, legacy])
    expect(stats.byStars.find((b) => b.key === '2')!.tally).toMatchObject({ won: 1, decided: 1 })
    expect(stats.byStars.find((b) => b.key === '3')!.tally).toMatchObject({ won: 0, decided: 1 })
    expect(stats).toMatchObject({ recomputed: 1, missing: 0 })
    expect(recomputedNote(stats)).toBe('1 öneri yeniden hesaplandı (eski kayıt)')
    expect(recomputedNote(buildStarStats([stored]))).toBeNull()
  })

  it('Taraf & Gol: kayıtlı yıldızı olan öneri tablolara girer, eski kayıt girmez', () => {
    const withStars = pick('won', 'homeWin15', TODAY, { reliability: 'market', stars: 4, modelDrift: false })
    const legacy = pick('lost', 'homeWin15', TODAY, { reliability: 'market' })
    const stats = buildStarStats([withStars, legacy])
    expect(stats.byCategory.map((c) => c.key)).toEqual(['homeWin15'])
    expect(stats.byStars.find((b) => b.key === '4')!.tally).toMatchObject({ won: 1, decided: 1 })
    expect(stats).toMatchObject({ recomputed: 0, missing: 1 })
  })

  it('geçersiz kayıt (0, 6, metin) yok sayılır', () => {
    for (const bad of [0, 6, 2.5, '3' as unknown as number]) expect(starsOf(pick('won', 'over25', TODAY, { stars: bad }))!.source).toBe('recomputed')
  })

  it('özet ve CSV kayıtlı yıldızı kullanır; not yalnızca eski kayıt varsa yazılır', () => {
    const fresh = [
      ...many(3, 'won', 'over25', TODAY, { stars: 5, reliability: 'high' }),
      ...many(2, 'lost', 'homeWin15', TODAY, { stars: 2, reliability: 'market', modelDrift: true }),
    ]
    const allStored = buildStatsSummary(input({ kind: 'all' }, { picks: fresh, matches: [] }))
    const body = section(allStored, 'Yıldız sayısına göre başarı')
    expect(row(body, '5 yıldız').slice(1, 4)).toEqual(['3', '3', '%100'])
    expect(row(body, 'EV KAZANIR & 1.5 ÜST')[4]).toBe('%0 · n=2')
    expect(body).not.toContain('yeniden hesaplandı')
    expect(body).not.toContain('yıldız bulunamadığı')

    const mixed = buildStatsSummary(input({ kind: 'all' }, { picks: [...fresh, pick('won', 'btts', TODAY), pick('won', 'awayWin15', TODAY, { reliability: 'market' })], matches: [] }))
    const mixedBody = section(mixed, 'Yıldız sayısına göre başarı')
    expect(mixedBody).toContain('1 öneri yeniden hesaplandı (eski kayıt)')
    expect(mixedBody).toContain('1 eski öneride (Taraf & Gol ya da güvenilirliği kayıtlı olmayan) yıldız bulunamadığı için')

    const rows = buildDetailRows(input({ kind: 'all' }, { picks: fresh, matches: [] }))
    expect(rows.map((r) => r[DETAIL_CSV_COLUMNS.indexOf('yildiz')])).toEqual(['5', '5', '5', '2', '2'])
  })

  it('yıldız ve sapma bilgisi yedekten aynen geri gelir', () => {
    const saved = [pick('won', 'over25', TODAY, { stars: 4 }), pick('lost', 'homeWin15', TODAY, { stars: 2, modelDrift: 'none', reliability: 'market' })]
    const file = JSON.parse(
      JSON.stringify({ app: 'gollazim', version: 1, exportedAt: '', uploads: [], matches: [], results: [], picks: saved, thresholds: defaultThresholds() }),
    ) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(file.picks).toEqual(saved)
    expect(buildStarStats(file.picks)).toMatchObject({ recomputed: 0, missing: 0 })
    // Yıldız alanı olmayan eski yedek de geçerlidir
    const old = { ...file, picks: saved.map(({ stars: _stars, modelDrift: _drift, ...rest }) => rest) }
    expect(isBackupFile(old)).toBe(true)
    expect(buildStarStats(old.picks as Pick[])).toMatchObject({ recomputed: 1, missing: 1 })
  })
})
