import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import type { AiVerdict, BackupFile, Match, MatchResult, ScoreLine } from '../../types'
import { collectAiMatches } from '../ai/collect'
import { numberMap, parseAiResponse, parseLine, parseScore } from '../ai/parser'
import { buildPrompts, matchBlock } from '../ai/prompt'
import { analyzeDay } from '../analysis/engine'
import { buildScoreSnapshot, scoreForecast, snapshotToSave, sourceLabel } from '../analysis/scoreForecast'
import { sideWinsAndGoals } from '../analysis/sideGoals/scoreModel'
import { buildSideGoalsModel } from '../analysis/sideGoals/sideGoals'
import { makeMatch } from '../analysis/testUtils'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { isAfterKickoff } from '../story/shared'
import { buildScoreStats, scoreRow, SCORE_SOURCES } from './scoreStats'
import { buildDetailRows, buildStatsSummary, DETAIL_CSV_COLUMNS } from './statsSummary'

const priced = () => makeMatch({ oddsHome: 8.5, oddsDraw: 6.3, oddsAway: 1.28, oddsOver25: 1.42, oddsUnder25: 2.62, homeXg: 0.9, awayXg: 2.1 })
const NOW = '2026-10-06T18:00:00.000Z'

describe('skor olasılıkları', () => {
  it('mevcut skor modelinden okunur: olasılıklar toplamı ~%100', () => {
    const forecast = scoreForecast(priced())!
    expect(forecast.source).toBe('market')
    expect(forecast.totals.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(forecast.outcome.home + forecast.outcome.draw + forecast.outcome.away).toBeCloseTo(1, 6)
    expect(forecast.top).toHaveLength(3)
    expect(forecast.top[0].probability).toBeGreaterThanOrEqual(forecast.top[1].probability)
    expect(forecast.top[1].probability).toBeGreaterThanOrEqual(forecast.top[2].probability)
  })

  it('Taraf & Gol hesabıyla aynı tablodur', () => {
    const match = priced()
    const model = buildSideGoalsModel(match)!
    const forecast = scoreForecast(match)!
    // Deplasman kazanır = 1.5 üstü deplasman galibiyetleri + 0-1
    const awayOver15 = sideWinsAndGoals(model.main.home, model.main.away, 'away', 2)
    const awayAny = sideWinsAndGoals(model.main.home, model.main.away, 'away', 0)
    expect(forecast.outcome.away).toBeCloseTo(awayAny, 10)
    expect(awayAny).toBeGreaterThan(awayOver15)
    expect(forecast.expectedGoals).toBeCloseTo(model.main.home + model.main.away, 10)
    // Croatia – Spain oranlarıyla en olası skor 0-2'dir
    expect(forecast.top.map((s) => `${s.home}-${s.away}`)).toEqual(['0-2', '1-2', '0-3'])
    expect(Math.round(forecast.top[0].probability * 1000) / 10).toBe(11.1)
  })

  it('oran yoksa xG tabanlıdır; ikisi de yoksa veri yoktur', () => {
    const xg = scoreForecast(makeMatch({ homeXg: 1.6, awayXg: 1.1 }))!
    expect(xg.source).toBe('xg')
    expect(sourceLabel(xg.source)).toBe('xG tabanlı')
    expect(sourceLabel('market')).toBe('Piyasa tabanlı')
    expect(sourceLabel('market-side')).toBe('Piyasa tabanlı')
    expect(scoreForecast(makeMatch({ over25Pct: 90, bttsPct: 80 }))).toBeNull()
    expect(scoreForecast(makeMatch({ homeXg: 0, awayXg: 1.1 }))).toBeNull()
  })
})

describe('anlık görüntü', () => {
  it('ilk "tamamlandı" anında alınır: en olası skor, ilk 3, 1/X/2, beklenen gol ve kaynak', () => {
    const snapshot = buildScoreSnapshot(priced(), NOW)
    expect(snapshot).toMatchObject({ source: 'market', takenAt: NOW, best: { home: 0, away: 2 } })
    expect(snapshot.top!.map((s) => [s.home, s.away])).toEqual([
      [0, 2],
      [1, 2],
      [0, 3],
    ])
    expect(snapshot.top![0].percent).toBe(11.1)
    expect(snapshot.outcome!.home + snapshot.outcome!.draw + snapshot.outcome!.away).toBeCloseTo(100, 0)
    expect(snapshot.expectedGoals).toBe(3.34)
  })

  it('veri yoksa kaynak "none" olur ve skor yazılmaz', () => {
    expect(buildScoreSnapshot(makeMatch({ over25Pct: 90 }), NOW)).toEqual({ source: 'none', takenAt: NOW })
  })

  it('yalnızca bir kez alınır: tamamlanmamış maçta alınmaz, kaydı olan maçta yenilenmez', () => {
    const match = priced()
    expect(snapshotToSave(match, 'pending', NOW)).toBeNull()
    expect(snapshotToSave(match, 'postponed', NOW)).toBeNull()
    const first = snapshotToSave(match, 'completed', NOW)!
    expect(first.best).toEqual({ home: 0, away: 2 })
    // Oranlar sonradan değişse de (CSV yeniden yüklendi) kayıtlı görüntü durur
    const later: Match = { ...match, stats: { ...match.stats, oddsHome: 1.2, oddsAway: 12 }, scoreSnapshot: first }
    expect(snapshotToSave(later, 'completed', '2026-10-07T10:00:00.000Z')).toBeNull()
    expect(later.scoreSnapshot).toBe(first)
    // Veri yok görüntüsü de bir kayıttır; yeniden alınmaz
    expect(snapshotToSave({ ...match, scoreSnapshot: { source: 'none', takenAt: NOW } }, 'completed', NOW)).toBeNull()
  })

  it('maç kaydının parçası olarak yedeğe girer ve aynen geri gelir', () => {
    const match: Match = { ...priced(), scoreSnapshot: buildScoreSnapshot(priced(), NOW) }
    const verdict: AiVerdict = { id: 'x|chatgpt', matchId: match.id, date: match.date, provider: 'chatgpt', decision: 'strong', reason: 'r', risk: 'k', savedAt: NOW, score: { home: 2, away: 1 }, scoreLate: false }
    const file = JSON.parse(
      JSON.stringify(assembleBackup({ uploads: [], matches: [match], results: [], picks: [], thresholds: defaultThresholds(), aiVerdicts: [verdict] }, new Date(NOW))),
    ) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(file.matches[0].scoreSnapshot).toEqual(match.scoreSnapshot)
    expect(file.aiVerdicts![0]).toEqual(verdict)
  })
})

describe('ayrıştırıcı: skor alanı', () => {
  const numbers = numberMap(['mA', 'mB', 'mC'])
  const verdict = (line: string) => {
    const result = parseLine(line, numbers)
    if (result.kind !== 'verdict') throw new Error(`${result.kind}: ${line}`)
    return result.verdict
  }

  it.each([
    ['2-1', { home: 2, away: 1 }],
    ['2:1', { home: 2, away: 1 }],
    ['2 - 1', { home: 2, away: 1 }],
    ['2–1', { home: 2, away: 1 }],
    ['SKOR: 2-1', { home: 2, away: 1 }],
    ['Skor 0 : 0', { home: 0, away: 0 }],
    ['skor tahmini: 3-2', { home: 3, away: 2 }],
    ['**SKOR: 1-1**', { home: 1, away: 1 }],
    ['10-0', { home: 10, away: 0 }],
  ] as [string, ScoreLine][])('"%s" okunur', (text, expected) => {
    expect(verdict(`#1 | Güçlü | gerekçe. | risk | ${text}`).score).toEqual(expected)
  })

  it('skor olmayan metin skor sayılmaz', () => {
    for (const text of ['2', '2-1-0', 'iki bir', '2.5 üst', '100-1', 'oran 1-2 arası']) expect(parseScore(text), text).toBeNull()
  })

  it('beş alanlı cevapta gerekçe ve risk yerinde kalır', () => {
    expect(verdict('#2 | Orta | Ev sahibi formda. | Rotasyon | SKOR: 2-1')).toEqual({
      number: 2,
      matchId: 'mB',
      decision: 'medium',
      reason: 'Ev sahibi formda.',
      risk: 'Rotasyon',
      score: { home: 2, away: 1 },
    })
  })

  it('dört alanlı eski cevap bozulmaz ve skor alanı hiç oluşmaz', () => {
    const old = verdict('#1 | Güçlü | Ev sahibi formda. | Rotasyon')
    expect(old).toEqual({ number: 1, matchId: 'mA', decision: 'strong', reason: 'Ev sahibi formda.', risk: 'Rotasyon' })
    expect('score' in old).toBe(false)
    // Risk alanı skora benzese de dört alanlı cevapta risk olarak kalır
    expect(verdict('#1 | Güçlü | Gerekçe. | 2-1')).toMatchObject({ risk: '2-1' })
    expect('score' in verdict('#1 | Güçlü | Gerekçe. | 2-1')).toBe(false)
  })

  it('gerekçede fazladan | olsa da skor ve risk doğru ayrılır', () => {
    expect(verdict('#3 | Zayıf | Birinci kısım | ikinci kısım. | Sakatlık | 0-0')).toMatchObject({ reason: 'Birinci kısım | ikinci kısım.', risk: 'Sakatlık', score: { home: 0, away: 0 } })
    // Skor yoksa eski kural: son alan risktir
    expect(verdict('#3 | Zayıf | Birinci kısım | ikinci kısım. | Sakatlık')).toMatchObject({ reason: 'Birinci kısım | ikinci kısım.', risk: 'Sakatlık' })
  })

  it('skor bilerek boş bırakıldıysa o maç için boş kalır', () => {
    for (const empty of ['-', 'yok', 'SKOR: yok', 'bilinmiyor', 'Skor: -']) {
      const v = verdict(`#1 | Güçlü | Gerekçe. | Risk | ${empty}`)
      expect(v).toMatchObject({ reason: 'Gerekçe.', risk: 'Risk' })
      expect('score' in v, empty).toBe(false)
    }
    // Sonda boş alan (tablo biçimi)
    expect(verdict('| #1 | Güçlü | Gerekçe. | Risk | |')).toMatchObject({ risk: 'Risk' })
  })

  it('karışık cevap: bazı maçlarda skor var, bazılarında yok', () => {
    const result = parseAiResponse('#1 | Güçlü | a. | b | SKOR: 2-0\n#2 | Orta | c. | d\n#3 | Eleme | e. | f | 1:1', numbers)
    expect(result.errors).toEqual([])
    expect(result.verdicts.map((v) => v.score ?? null)).toEqual([{ home: 2, away: 0 }, null, { home: 1, away: 1 }])
  })
})

describe('prompt: skor alanı', () => {
  const match = priced()
  const items = collectAiMatches(analyzeDay([{ ...match, stats: { ...match.stats, over25Pct: 90 } }], defaultThresholds()))
  const [chunk] = buildPrompts(items, 'chatgpt', '6 Ekim 2026 Salı')

  it('cevap biçiminde isteğe bağlı skor alanı istenir', () => {
    expect(chunk.text).toContain('#numara | KARAR | gerekçe | risk | skor')
    expect(chunk.text).toContain('"SKOR: ev-deplasman"')
    expect(chunk.text).toContain('isteğe bağlıdır')
  })

  it('modelin skor olasılıkları prompta konmaz', () => {
    const forecast = scoreForecast(match)!
    const block = matchBlock(items[0], 1)
    expect(block).not.toMatch(/skor/i)
    for (const s of forecast.top) expect(block).not.toContain(`${s.home}-${s.away} %`)
    expect(chunk.text).not.toContain('olası skor')
    // Mevcut satırlar yerinde
    expect(block).toContain('Gol modeli:')
    expect(block).toContain('Piyasa:')
  })
})

const DAY = '2026-10-05'
const match = (id: string, best?: ScoreLine, date = DAY, time = '20:00'): Match => ({
  id,
  uploadId: 'u',
  date,
  time,
  home: `Ev ${id}`,
  away: `Dep ${id}`,
  stats: {},
  ...(best && { scoreSnapshot: { source: 'market' as const, takenAt: NOW, best } }),
})
const result = (matchId: string, ftHome: number | null, ftAway: number | null, status: MatchResult['status'] = 'completed'): MatchResult => ({
  matchId,
  status,
  htHome: 0,
  htAway: 0,
  ftHome,
  ftAway,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt: NOW,
})
const ai = (matchId: string, provider: AiVerdict['provider'], score: ScoreLine | undefined, scoreLate = false, date = DAY): AiVerdict => ({
  id: `${matchId}|${provider}`,
  matchId,
  date,
  provider,
  decision: 'strong',
  reason: '',
  risk: '',
  savedAt: NOW,
  ...(score && { score, scoreLate }),
})

describe('skor tahmini ölçümü', () => {
  it('tam skor, sonuç isabeti ve toplam gol ortalama mutlak hatası', () => {
    const row = scoreRow('model', 'Model', [
      [{ home: 2, away: 1 }, { home: 2, away: 1 }], // tam; sonuç doğru; hata 0
      [{ home: 1, away: 0 }, { home: 3, away: 1 }], // sonuç doğru; hata 3
      [{ home: 1, away: 1 }, { home: 0, away: 0 }], // sonuç doğru (beraberlik); hata 2
      [{ home: 0, away: 2 }, { home: 2, away: 0 }], // yanlış; hata 0
    ])
    expect(row).toMatchObject({ n: 4, exact: 25, outcome: 75, totalGoalsError: 1.25, lowSample: true })
    expect(scoreRow('model', 'Model', [])).toMatchObject({ n: 0, exact: null, outcome: null, totalGoalsError: null })
  })

  const matches = [match('a', { home: 2, away: 1 }), match('b', { home: 1, away: 0 }), match('c', { home: 0, away: 0 }), match('d'), match('e', { home: 1, away: 1 }), match('f', { home: 3, away: 0 })]
  const results = [
    result('a', 2, 1),
    result('b', 0, 0),
    result('c', 1, 1),
    result('d', 2, 1), // modelin tahmini yok (eski maç)
    result('e', null, null, 'pending'), // skor girilmemiş
    result('f', null, null, 'postponed'),
  ]
  const verdicts = [
    ai('a', 'chatgpt', { home: 2, away: 1 }),
    ai('b', 'chatgpt', { home: 0, away: 0 }, true), // başladıktan sonra: sayılmaz
    ai('c', 'chatgpt', undefined), // skor tahmini yok
    ai('d', 'chatgpt', { home: 1, away: 0 }),
    ai('e', 'chatgpt', { home: 1, away: 0 }), // skor girilmemiş maç
    ai('a', 'gemini', { home: 1, away: 1 }),
  ]
  const stats = buildScoreStats({ matches, results, verdicts })
  const row = (id: string) => stats.rows.find((r) => r.id === id)!

  it('kaynaklar ve referanslar sabit sırayla', () => {
    expect(SCORE_SOURCES.map((s) => s.label)).toEqual(['Model', 'ChatGPT', 'Gemini', 'Claude', 'Referans: hep 1-1', 'Referans: hep 2-1'])
    expect(stats.rows.map((r) => r.id)).toEqual(['model', 'chatgpt', 'gemini', 'claude', 'ref11', 'ref21'])
  })

  it('yalnızca skoru girilmiş ve tahmini olan maçlar sayılır', () => {
    expect(stats.scored).toBe(4)
    // Model: a (tam), b (1-0 / 0-0: yanlış, hata 1), c (0-0 / 1-1: sonuç doğru, hata 2)
    expect(row('model')).toMatchObject({ n: 3, exact: 33.3, outcome: 66.7, totalGoalsError: 1 })
    // ChatGPT: a (tam) ve d (1-0 / 2-1: sonuç doğru, hata 2)
    expect(row('chatgpt')).toMatchObject({ n: 2, exact: 50, outcome: 100, totalGoalsError: 1 })
    expect(row('gemini')).toMatchObject({ n: 1, exact: 0, outcome: 0, totalGoalsError: 1 })
  })

  it('maç başladıktan sonra kaydedilen tahmin ölçüme girmez ama sayısı bildirilir', () => {
    expect(stats.late).toBe(1)
    const withLate = buildScoreStats({ matches, results, verdicts: verdicts.map((v) => ({ ...v, scoreLate: false })) })
    expect(withLate.rows.find((r) => r.id === 'chatgpt')!.n).toBe(3)
    expect(withLate.late).toBe(0)
    // İşaret, kaydın maç başlangıcına göre zamanına bakar
    expect(isAfterKickoff(match('a'), '2026-10-05T16:59:00.000Z')).toBe(false)
    expect(isAfterKickoff(match('a'), '2026-10-05T17:00:00.000Z')).toBe(true)
  })

  it('referanslar skoru girilmiş tüm maçlarda ölçülür', () => {
    // Gerçek skorlar: 2-1, 0-0, 1-1, 2-1
    expect(row('ref11')).toMatchObject({ n: 4, exact: 25, outcome: 50, totalGoalsError: 1 })
    expect(row('ref21')).toMatchObject({ n: 4, exact: 50, outcome: 50, totalGoalsError: 1 })
  })

  it('az veri: 20 maçtan az', () => {
    expect(row('model').lowSample).toBe(true)
    const many = Array.from({ length: 20 }, (_, i) => match(`x${i}`, { home: 1, away: 0 }))
    const big = buildScoreStats({ matches: many, results: many.map((m) => result(m.id, 1, 0)), verdicts: [] })
    expect(big.rows.find((r) => r.id === 'model')).toMatchObject({ n: 20, exact: 100, lowSample: false })
    expect(big.rows.find((r) => r.id === 'chatgpt')).toMatchObject({ n: 0, exact: null })
  })

  it('özet metnine ve CSV\'ye girer; kapsam maçın gününe göre uygulanır', () => {
    const picks = [
      { id: 'p1', matchId: 'a', categoryId: 'over25' as const, date: DAY, percent: 90, threshold: 75, outcome: 'won' as const, frozenAt: NOW, reliability: 'low' as const },
      { id: 'p2', matchId: 'b', categoryId: 'over25' as const, date: DAY, percent: 85, threshold: 75, outcome: 'lost' as const, frozenAt: NOW, reliability: 'low' as const },
    ]
    const input = { now: new Date(NOW), today: '2026-10-06', scope: { kind: 'all' as const }, includeGuide: false, picks, matches, results, verdicts, shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25 }
    const text = buildStatsSummary(input)
    const section = text.slice(text.indexOf('## Skor tahminleri (deney)'), text.indexOf('## Veri kısıtları'))
    expect(section).toContain('| Model | %33,3 | %66,7 | 1 | 3 | az veri |')
    expect(section).toContain('| ChatGPT | %50 | %100 | 1 | 2 | az veri |')
    expect(section).toContain('| Referans: hep 2-1 | %50 | %50 | 1 | 4 | az veri |')
    expect(section).toContain('Kapsamda skoru girilmiş 4 maç.')
    expect(section).toContain('1 yapay zekâ tahmini maç başladıktan sonra kaydedildiği için sayılmadı.')
    // Kapsam dışı gün: hiçbir maç sayılmaz
    const other = buildStatsSummary({ ...input, picks: [...picks, { ...picks[0], id: 'p3', matchId: 'z', date: '2026-09-01' }], scope: { kind: 'range', from: '2026-09-01', to: '2026-09-01' } })
    expect(other).toContain('Kapsamda skoru girilmiş 0 maç.')

    const rows = buildDetailRows(input)
    const col = (name: (typeof DETAIL_CSV_COLUMNS)[number]) => DETAIL_CSV_COLUMNS.indexOf(name)
    expect(DETAIL_CSV_COLUMNS.slice(-4)).toEqual(['mac_skoru', 'model_skor', 'ai_chatgpt_skor', 'ai_gemini_skor'])
    expect(rows[0].slice(-4)).toEqual(['2-1', '2-1', '2-1', '1-1'])
    // b: ChatGPT tahmini maç başladıktan sonra kaydedildi, boş kalır
    expect(rows[1].slice(-4)).toEqual(['0-0', '1-0', '', ''])
    expect(rows[1][col('sonuc')]).toBe('tutmadı')
  })
})
