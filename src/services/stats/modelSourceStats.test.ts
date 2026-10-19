import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ModelSourceLine, { MODEL_NONE_TEXT } from '../../components/ModelSourceLine'
import { defaultThresholds, type CategoryId } from '../../config/categories'
import type { Match, MatchResult, Pick, PickOutcome, Upload } from '../../types'
import { goalModelPercent } from '../analysis/goalModel'
import { makeMatch } from '../analysis/testUtils'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { buildGoalModelSourceStats, buildScoreSourceStats, buildSideGoalsSourceStats, deriveUnknownSources, pickModelSource, sideGoalsMainSource } from './modelSourceStats'
import { buildScoreStats } from './scoreStats'
import { buildStats } from './statsEngine'
import { buildStatsSummary, type SummaryInput } from './statsSummary'

// Ölçümlerin model kaynağına göre ayrımı. Değerler sentetiktir.

let n = 0
const pick = (categoryId: CategoryId, outcome: PickOutcome, extra: Partial<Pick> = {}): Pick => ({
  id: `k${++n}`,
  matchId: `km${n}`,
  categoryId,
  date: '2026-10-09',
  percent: 90,
  threshold: 75,
  outcome,
  frozenAt: '2026-10-09T21:00:00.000Z',
  reliability: 'medium',
  secondPercent: 60,
  conflict: true,
  ...extra,
})
const many = (count: number, categoryId: CategoryId, outcome: PickOutcome, extra: Partial<Pick> = {}) => Array.from({ length: count }, () => pick(categoryId, outcome, extra))

const picks: Pick[] = [
  // xG: 20 sonuçlanmış (az veri değil)
  ...many(12, 'over25', 'won', { modelSource: 'xg', secondPercent: 62, conflict: true }),
  ...many(8, 'btts', 'lost', { modelSource: 'xg', secondPercent: 80, percent: 84, conflict: false }),
  // ort. gol: az veri
  ...many(2, 'over35', 'lost', { modelSource: 'avgGoals', secondPercent: 70, percent: 96, conflict: true }),
  ...many(1, 'over25', 'won', { modelSource: 'avgGoals', secondPercent: 71, percent: 78, conflict: false }),
  // model yok
  ...many(2, 'over45', 'won', { modelSource: 'none', secondPercent: null, conflict: undefined, percent: 100 }),
  ...many(1, 'btts', 'void', { modelSource: 'none', secondPercent: null, conflict: undefined }),
  // eski kayıt: kaynak yok, model yüzdesi var
  ...many(3, 'over25', 'won', { secondPercent: 50 }),
  ...many(1, 'over25', 'pending', { secondPercent: 50 }),
  // eski kayıt: ne kaynak ne model yüzdesi
  ...many(2, 'over25', 'lost', { secondPercent: null, conflict: undefined }),
  pick('over35', 'won', { secondPercent: undefined, conflict: undefined }),
  // kapsam dışı kategori
  ...many(4, 'ht05', 'won', { secondPercent: undefined, conflict: undefined }),
]

describe('gol modeli: kaynağa göre kalibrasyon', () => {
  const stats = buildGoalModelSourceStats(picks)!
  const row = (key: string) => stats.rows.find((r) => r.key === key)!

  it('satırlar: xG, ort. gol, model yok, bilinmiyor (bu sırayla); yalnızca önerisi olanlar', () => {
    expect(stats.rows.map((r) => r.key)).toEqual(['xg', 'avgGoals', 'none', 'unknown'])
    expect(buildGoalModelSourceStats(picks.filter((p) => p.modelSource === 'xg'))!.rows.map((r) => r.key)).toEqual(['xg'])
    expect(buildGoalModelSourceStats(picks.filter((p) => p.categoryId === 'ht05'))).toBeNull()
  })

  it('her kaynak için hazır ort., model ort., gerçekleşen ve n; çelişkili / çelişkisiz ayrı', () => {
    expect(row('xg')).toMatchObject({ ready: 87.6, model: 69.2, tally: { decided: 20, won: 12, rate: 60, lowSample: false } })
    expect(row('xg').conflict).toMatchObject({ decided: 12, rate: 100 })
    expect(row('xg').clear).toMatchObject({ decided: 8, rate: 0 })
    expect(row('avgGoals')).toMatchObject({ ready: 90, model: 70.3, tally: { decided: 3, won: 1, rate: 33.3, lowSample: true } })
  })

  it('model yok: model ortalaması ve çelişki yoktur; değerlendirilemeyen orana girmez', () => {
    expect(row('none')).toMatchObject({ ready: 100, model: null, clear: null, conflict: null, tally: { decided: 2, void: 1, rate: 100, lowSample: true } })
  })

  it('kaynağı kayıtlı olmayan eski öneriler yalnızca "bilinmiyor" satırındadır; hiçbir kaynağa karışmaz', () => {
    expect(row('unknown').tally).toMatchObject({ decided: 3, pending: 1, total: 4 })
    const known = picks.filter((p) => p.modelSource)
    const withoutOld = buildGoalModelSourceStats(known)!
    for (const key of ['xg', 'avgGoals', 'none']) expect(withoutOld.rows.find((r) => r.key === key)).toEqual(row(key))
    expect(withoutOld.rows.some((r) => r.key === 'unknown')).toBe(false)
  })

  it('ne kaynağı ne model yüzdesi kayıtlı olan eski öneri hiçbir satıra girmez, sayılır', () => {
    expect(stats.unknownWithoutModel).toBe(3)
    expect(stats.rows.reduce((sum, r) => sum + r.tally.total, 0)).toBe(picks.filter((p) => p.categoryId !== 'ht05').length - 3)
  })

  it('xG + ort. gol + bilinmiyor satırları, mevcut "dört kategori birlikte" satırıyla aynı önerilerdir', () => {
    const all = buildStats(picks).goalModel!.calibration.find((r) => r.key === 'all')!
    const modeled = stats.rows.filter((r) => r.key !== 'none')
    expect(modeled.reduce((sum, r) => sum + r.tally.decided, 0)).toBe(all.tally.decided)
    expect(modeled.reduce((sum, r) => sum + r.tally.won, 0)).toBe(all.tally.won)
    expect(modeled.reduce((sum, r) => sum + r.tally.total, 0)).toBe(all.tally.total)
  })

  it('tanınmayan bir kaynak değeri de "bilinmiyor" sayılır', () => {
    expect(pickModelSource(pick('over25', 'won', { modelSource: 'başka' as never }))).toBe('unknown')
    expect(pickModelSource(pick('over25', 'won'))).toBe('unknown')
    expect(pickModelSource(pick('over25', 'won', { modelSource: 'avgGoals' }))).toBe('avgGoals')
  })
})

describe('türetme bilgi satırı (kayıt değil)', () => {
  const UPLOAD: Upload = { id: 'u-eski', fileName: 'a.csv', uploadedAt: '2026-10-09T08:00:00.000Z', matchCount: 4 }
  const LATE: Upload = { id: 'u-yeni', fileName: 'b.csv', uploadedAt: '2026-10-10T08:00:00.000Z', matchCount: 1 }
  const match = (id: string, stats: Record<string, number>, extra: Partial<Match> = {}): Match => makeMatch({ over25Pct: 90, ...stats }, { id, uploadId: UPLOAD.id, date: '2026-10-09', ...extra })
  const xg = match('t-xg', { homeXg: 1.6, awayXg: 1.5, avgGoals: 2.2 })
  const avg = match('t-avg', { avgGoals: 3.1 })
  const old = (m: Match, extra: Partial<Pick> = {}) => pick('over25', 'won', { matchId: m.id, secondPercent: goalModelPercent(m, 'over25')!.percent, ...extra })
  const derive = (list: Pick[], matches: Match[], uploads: Upload[] | undefined = [UPLOAD, LATE]) => deriveUnknownSources(list, matches, uploads)

  it('dört koşul da sağlanınca kaynak maç kaydından okunur: xG / ort. gol', () => {
    expect(goalModelPercent(xg, 'over25')!.source).toBe('xg')
    expect(goalModelPercent(avg, 'over25')!.source).toBe('avgGoals')
    expect(derive([old(xg), old(xg), old(avg)], [xg, avg])).toEqual({ total: 3, xg: 2, avgGoals: 1, unverified: 0 })
  })

  it('koşul 1: maç kaydı yoksa doğrulanamaz', () => {
    expect(derive([old(xg)], [])).toEqual({ total: 1, xg: 0, avgGoals: 0, unverified: 1 })
  })

  it('koşul 2: maç elle düzenlenmişse doğrulanamaz (yüzde tutsa bile)', () => {
    expect(derive([old(xg)], [{ ...xg, edited: true }])).toMatchObject({ xg: 0, unverified: 1 })
  })

  it('koşul 3: CSV dondurmadan sonra yenilenmişse doğrulanamaz (yüzde tutsa bile); yükleme kaydı yoksa da', () => {
    expect(derive([old(xg)], [{ ...xg, uploadId: LATE.id }])).toMatchObject({ xg: 0, unverified: 1 })
    expect(derive([old(xg)], [{ ...xg, uploadId: 'silinmis' }])).toMatchObject({ xg: 0, unverified: 1 })
    // Dondurma zamanı kayıtlı değilse karşılaştırma yapılamaz.
    expect(derive([old(xg, { frozenAt: '' })], [xg])).toMatchObject({ xg: 0, unverified: 1 })
    // Yükleme, dondurmayla aynı anda ya da önceyse kayıt yenilenmemiştir.
    expect(derive([old(xg, { frozenAt: UPLOAD.uploadedAt })], [xg])).toMatchObject({ xg: 1, unverified: 0 })
  })

  it('koşul 4: yeniden hesaplanan Model % kayıtlıdan farklıysa doğrulanamaz', () => {
    expect(derive([old(xg, { secondPercent: goalModelPercent(xg, 'over25')!.percent + 1 })], [xg])).toMatchObject({ xg: 0, unverified: 1 })
  })

  it('yalnızca kaynağı bilinmeyen, model yüzdesi kayıtlı öneriler sayılır', () => {
    const list = [old(xg), old(xg, { modelSource: 'xg' }), old(xg, { secondPercent: null }), pick('ht05', 'won', { matchId: xg.id })]
    expect(derive(list, [xg])).toEqual({ total: 1, xg: 1, avgGoals: 0, unverified: 0 })
  })

  it('yükleme zamanı okunamıyorsa (yüklemeler verilmedi) döküm yapılmaz', () => {
    expect(deriveUnknownSources([old(xg)], [xg], undefined)).toBeNull()
  })

  it('hiçbir kaydı değiştirmez: öneriler ve maçlar aynen kalır, kaynak alanı yazılmaz', () => {
    const list = [old(xg), old(avg)]
    const before = JSON.stringify([list, xg, avg])
    derive(list, [xg, avg])
    buildGoalModelSourceStats(list)
    expect(JSON.stringify([list, xg, avg])).toBe(before)
    expect(list.every((p) => !('modelSource' in p))).toBe(true)
    // Türetme tabloyu da değiştirmez: iki öneri "bilinmiyor" satırında kalır.
    expect(buildGoalModelSourceStats(list)!.rows.map((r) => [r.key, r.tally.total])).toEqual([['unknown', 2]])
  })
})

describe('Taraf & Gol ve skor tahmini: kayıtlı kaynağa göre', () => {
  it('Taraf & Gol ana hesabının kaynağı kayıtlı güvenilirlikten okunur; güvenilirliği olmayan eski kayıt "bilinmiyor"', () => {
    expect(sideGoalsMainSource(pick('homeWin15', 'won', { reliability: 'market' }))).toBe('market')
    expect(sideGoalsMainSource(pick('homeWin15', 'won', { reliability: 'market-partial' }))).toBe('market-side')
    for (const level of ['low', 'medium', 'high', 'unknown'] as const) expect(sideGoalsMainSource(pick('homeWin15', 'won', { reliability: level }))).toBe('xg')
    expect(sideGoalsMainSource(pick('homeWin15', 'won', { reliability: undefined }))).toBe('unknown')
  })

  it('Taraf & Gol satırları: ortalama tahmin, xG modeli ortalaması, gerçekleşen; toplam mevcut "tüm Taraf & Gol" satırıdır', () => {
    const side = [
      ...many(3, 'homeWin15', 'won', { reliability: 'market', percent: 60, secondPercent: 40 }),
      ...many(1, 'homeWin25', 'lost', { reliability: 'market', percent: 50, secondPercent: null }),
      ...many(2, 'awayWin15', 'lost', { reliability: 'market-partial', percent: 58, secondPercent: 44 }),
      ...many(1, 'awayWin25', 'won', { reliability: 'low', percent: 47, secondPercent: null }),
      ...many(1, 'homeWin15', 'won', { reliability: undefined, percent: 70, secondPercent: 30 }),
    ]
    const rows = buildSideGoalsSourceStats([...side, ...picks])
    expect(rows.map((r) => r.key)).toEqual(['market', 'market-side', 'xg', 'unknown'])
    expect(rows[0]).toMatchObject({ predicted: 57.5, second: 40, tally: { decided: 4, won: 3 } })
    expect(rows[1]).toMatchObject({ predicted: 58, second: 44, tally: { decided: 2, won: 0 } })
    expect(rows[2]).toMatchObject({ predicted: 47, second: null, tally: { decided: 1 } })
    const all = buildStats(side).sideGoals!.calibration.find((r) => r.key === 'all')!
    expect(rows.reduce((sum, r) => sum + r.tally.decided, 0)).toBe(all.tally.decided)
    expect(rows.reduce((sum, r) => sum + r.tally.won, 0)).toBe(all.tally.won)
  })

  it('skor tahmini: "Model" satırı anlık görüntünün kayıtlı kaynağına göre bölünür; toplamı aynıdır', () => {
    const snap = (id: string, source: 'market' | 'market-side' | 'xg' | 'none', best?: { home: number; away: number }): Match => makeMatch({}, { id, date: '2026-10-09', scoreSnapshot: { source, takenAt: '', ...(best && { best }) } })
    const done = (matchId: string, ftHome: number, ftAway: number): MatchResult => ({ matchId, status: 'completed', htHome: 0, htAway: 0, ftHome, ftAway, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '' })
    const matches = [snap('s1', 'market', { home: 2, away: 1 }), snap('s2', 'market', { home: 1, away: 1 }), snap('s3', 'market-side', { home: 1, away: 0 }), snap('s4', 'xg', { home: 0, away: 0 }), snap('s5', 'none'), makeMatch({}, { id: 's6', date: '2026-10-09' })]
    const results = [done('s1', 2, 1), done('s2', 0, 2), done('s3', 3, 0), done('s4', 1, 1), done('s5', 1, 0), done('s6', 1, 0)]
    const rows = buildScoreSourceStats(matches, results)
    expect(rows.map((r) => [r.label.split(':')[1].trim().split(' ')[0], r.n, r.exact, r.outcome])).toEqual([
      ['piyasa', 2, 50, 50],
      ['kısmi', 1, 0, 100],
      ['yalnızca', 1, 0, 100],
    ])
    expect(rows.every((r) => r.lowSample)).toBe(true)
    const model = buildScoreStats({ matches, results, verdicts: [] }).rows.find((r) => r.id === 'model')!
    expect(rows.reduce((sum, r) => sum + r.n, 0)).toBe(model.n)
    expect(buildScoreSourceStats([], [])).toEqual([])
  })
})

describe('özet: kaynağa göre tablolar', () => {
  const input = (extra: Partial<SummaryInput> = {}): SummaryInput => ({ now: new Date('2026-10-10T09:30:00.000Z'), today: '2026-10-10', scope: { kind: 'all' }, includeGuide: false, picks, matches: [], verdicts: [], shared: [], thresholds: defaultThresholds(), marketConflictLimit: 25, ...extra })
  const section = (text: string, title: string) => {
    const start = text.indexOf(`## ${title}`)
    return text.slice(start, text.indexOf('\n## ', start + 1))
  }
  const row = (text: string, first: string) => text.split('\n').find((l) => l.startsWith(`| ${first} |`))?.split('|').slice(1, -1).map((c) => c.trim())

  it('gol modeli bölümü: mevcut tablolar aynen durur, altına kaynak tablosu gelir; az veri * ile işaretlenir', () => {
    const part = section(buildStatsSummary(input()), 'Kalibrasyon: hazır yüzde ve gol modeli')
    expect(part).toContain('| Kategori | Hazır ort. | Model ort. | Gerçekleşen | Ort. fark (hazır − model) |')
    expect(part).toContain('| Model çelişkisi | Başarı |')
    expect(part).toContain('| Model kaynağı | Hazır ort. | Model ort. | Gerçekleşen | Çelişkisiz | Çelişkili |')
    expect(row(part, 'xG')).toEqual(['xG', '%87,6', '%69,2', '%60 · n=20', '%0 · n=8*', '%100 · n=12*'])
    // Özet yalnızca ana kategorileri sayar: 3.5 / 4.5 Üst önerileri (ort. gol, model yok, eski kayıt) girmez.
    expect(part).not.toMatch(/3\.5 ÜST|4\.5 ÜST/)
    expect(row(part, 'ort. gol (xG yok)')).toEqual(['ort. gol (xG yok)', '%78', '%71', '%100 · n=1*', '%100 · n=1*', '—'])
    expect(row(part, 'model yok')).toEqual(['model yok', '—', '—', '—', '—', '—'])
    expect(row(part, 'bilinmiyor (eski kayıt)')).toEqual(['bilinmiyor (eski kayıt)', '%90', '%50', '%100 · n=3*', '—', '%100 · n=3*'])
    expect(part).toContain('* az veri: n < 20.')
    expect(part).toContain('hiçbir kaynağa karıştırılmaz')
    expect(part).toContain('Ne kaynağı ne model yüzdesi kayıtlı olan 2 eski öneri bu tabloya girmez.')
  })

  it('türetme satırı yalnızca yükleme zamanı okunabiliyorsa ve bilinmeyen öneri varsa yazılır', () => {
    const title = 'Kalibrasyon: hazır yüzde ve gol modeli'
    expect(section(buildStatsSummary(input()), title)).not.toContain('türetme, kayıt değil')
    const withUploads = section(buildStatsSummary(input({ uploads: [] })), title)
    expect(withUploads).toContain('Kaynağı bilinmeyen 4 önerinin maç kaydına göre dökümü (türetme, kayıt değil): xG 0, ort. gol 0, doğrulanamayan 4.')
    // Tablo, türetme satırı olsa da olmasa da aynıdır.
    expect(row(withUploads, 'bilinmiyor (eski kayıt)')).toEqual(row(section(buildStatsSummary(input()), title), 'bilinmiyor (eski kayıt)'))
    const known = section(buildStatsSummary(input({ uploads: [], picks: picks.filter((p) => p.modelSource) })), title)
    expect(known).not.toContain('türetme, kayıt değil')
    expect(known).not.toContain('bilinmiyor (eski kayıt)')
  })

  it('yalnızca "model yok" önerisi olsa da kaynak tablosu yazılır', () => {
    const none = [...picks.filter((p) => p.modelSource === 'none'), ...many(2, 'btts', 'won', { modelSource: 'none', secondPercent: null, conflict: undefined, percent: 100 })]
    const part = section(buildStatsSummary(input({ picks: none })), 'Kalibrasyon: hazır yüzde ve gol modeli')
    expect(part).toContain('Model yüzdesi kayıtlı öneri yok.')
    expect(row(part, 'model yok')).toEqual(['model yok', '%100', '—', '%100 · n=2*', '—', '—'])
  })

  it('Taraf & Gol kalibrasyonu (kaynak tablosu dahil) özete yazılmaz; hesabı durur. Skor bölümüne veri yokken kaynak tablosu eklenmez', () => {
    const side = [...many(21, 'homeWin15', 'won', { reliability: 'market', percent: 60, secondPercent: 40 }), ...many(1, 'awayWin15', 'lost', { reliability: 'low', percent: 58, secondPercent: null })]
    const withMain = buildStatsSummary(input({ picks: [...side, ...picks] }))
    expect(withMain).not.toContain('Kalibrasyon: Taraf & Gol')
    expect(withMain).not.toContain('Ana hesabın kaynağına göre')
    expect(section(withMain, 'Skor tahminleri (deney)')).not.toContain('Modelin kaynağına göre')
    // Hesap kodu silinmedi: aynı satırları üretir.
    const rows = buildSideGoalsSourceStats(side)
    expect(rows.map((r) => [r.key, r.predicted, r.second, r.tally.decided, r.tally.won])).toEqual([
      ['market', 60, 40, 21, 21],
      ['xg', 58, null, 1, 0],
    ])
  })
})

describe('yedek', () => {
  const content = { uploads: [], matches: [], results: [], thresholds: defaultThresholds(), aiVerdicts: [], aiPrompts: [], storySelections: [], sharedPicks: [], leagueTables: [], teamAliases: [] }

  it('kaynak alanı yedeğe girer ve geri okunur; yedek biçimi (sürüm 1) aynıdır', () => {
    const backup = JSON.parse(JSON.stringify(assembleBackup({ ...content, picks } as never, new Date('2026-10-10T09:30:00.000Z'))))
    expect(isBackupFile(backup)).toBe(true)
    expect(backup.version).toBe(1)
    expect(backup.picks).toEqual(JSON.parse(JSON.stringify(picks)))
    expect(backup.picks.filter((p: Pick) => p.modelSource === 'avgGoals')).toHaveLength(3)
  })

  it('kaynak alanı olmayan eski yedek geçerlidir; önerileri "bilinmiyor" sayılır ve alan eklenmez', () => {
    const old = picks.map(({ modelSource: _unused, ...rest }) => rest)
    const backup = JSON.parse(JSON.stringify(assembleBackup({ ...content, picks: old } as never, new Date('2026-10-10T09:30:00.000Z'))))
    expect(isBackupFile(backup)).toBe(true)
    expect(backup.picks.every((p: Pick) => !('modelSource' in p) && pickModelSource(p) === 'unknown')).toBe(true)
  })
})

describe('admin kartı: Model % satırı', () => {
  const draw = (props: Parameters<typeof ModelSourceLine>[0]) => renderToStaticMarkup(createElement(ModelSourceLine, props))
  const text = (markup: string) => markup.replace(/<[^>]+>/g, '')

  it('xG: "Model · xG %59" (nötr); ort. gol: "Model · ort. gol %59" (sarı)', () => {
    const xg = draw({ categoryId: 'over25', secondPercent: 59, secondLabel: 'Model', secondSource: 'xg' })
    expect(text(xg)).toBe('Model · xG %59')
    expect(xg).not.toContain('text-warn')
    const avg = draw({ categoryId: 'over35', secondPercent: 59, secondLabel: 'Model', secondSource: 'avgGoals' })
    expect(text(avg)).toBe('Model · ort. gol %59')
    expect(avg).toContain('text-warn')
    expect(avg).toContain('data-source="avgGoals"')
  })

  it('model yokken ÜST ve KG kartlarında soluk "Model: veri yok" yazar', () => {
    for (const categoryId of ['over25', 'over35', 'over45', 'btts'] as const) {
      const none = draw({ categoryId, secondPercent: null, secondLabel: 'Model', secondSource: 'none' })
      expect(text(none)).toBe(MODEL_NONE_TEXT)
      expect(none).toContain('opacity-70')
    }
  })

  it('Taraf & Gol etiketi değişmez: "xG modeli %41"; ikinci hesap yoksa satır da yoktur', () => {
    expect(text(draw({ categoryId: 'homeWin15', secondPercent: 41, secondLabel: 'xG modeli', secondSource: 'xg' }))).toBe('xG modeli %41')
    expect(draw({ categoryId: 'homeWin15', secondPercent: null, secondLabel: 'xG modeli', secondSource: 'none' })).toBe('')
  })

  it('ikinci hesabı olmayan kategoride hiçbir şey çizilmez', () => {
    expect(draw({ categoryId: 'ht05', secondPercent: undefined, secondLabel: 'xG modeli', secondSource: undefined })).toBe('')
  })
})
