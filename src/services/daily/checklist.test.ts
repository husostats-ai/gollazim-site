import { describe, expect, it } from 'vitest'
import { defaultThresholds } from '../../config/categories'
import { BACKUP_ALERT_DAYS, BACKUP_WARN_DAYS, SCORE_DUE_HOURS } from '../../config/reminders'
import type { BackupFile, Match, MatchResult, Pick, PickOutcome } from '../../types'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { recordShare, removeShare } from '../story/shared'
import {
  backupStatus,
  buildChecklist,
  daysBetween,
  isScoreDue,
  missingCounts,
  scoresDue,
  sharedPending,
  sharingOf,
  sinceBackup,
  type ChecklistInput,
  type DayInput,
} from './checklist'

const TODAY = '2026-10-06'
const YESTERDAY = '2026-10-05'
// 6 Ekim 2026, Türkiye saatiyle 21:30
const NOW = new Date('2026-10-06T18:30:00.000Z')
const match = (id: string, date: string, time: string | null = '15:00'): Match => ({ id, uploadId: 'u', date, time: time ?? undefined, home: id, away: 'x', stats: {} })
const result = (matchId: string, status: MatchResult['status'] = 'completed', updatedAt = '2026-10-06T10:00:00.000Z'): MatchResult => ({
  matchId,
  status,
  htHome: 1,
  htAway: 0,
  ftHome: 2,
  ftAway: 1,
  cornersHome: null,
  cornersAway: null,
  cardsHome: null,
  cardsAway: null,
  updatedAt,
})
let n = 0
const pick = (matchId: string, categoryId: Pick['categoryId'], outcome: PickOutcome, date: string): Pick => ({
  id: `p${++n}`,
  matchId,
  categoryId,
  date,
  percent: 80,
  threshold: 70,
  outcome,
  frozenAt: '',
})
const day = (date: string, extra: Partial<DayInput> = {}): DayInput => ({ date, matches: [], recommendedIds: [], picks: [], shared: [], ...extra })

describe('yedek durumu', () => {
  const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()

  it('sınırlar tek dosyadan gelir', () => {
    expect([BACKUP_WARN_DAYS, BACKUP_ALERT_DAYS, SCORE_DUE_HOURS]).toEqual([3, 7, 2])
  })

  it('veri yoksa uyarı yoktur', () => {
    expect(backupStatus(null, NOW, false)).toEqual({ level: 'none', days: null, text: '' })
    expect(backupStatus(at(30), NOW, false).level).toBe('none')
  })

  it('veri var ama hiç yedek alınmamış', () => {
    expect(backupStatus(null, NOW, true)).toEqual({ level: 'never', days: null, text: 'Henüz yedek almadın.' })
  })

  it.each([
    [0, 'ok', 'Son yedek bugün alındı'],
    [1, 'ok', 'Son yedek 1 gün önce'],
    [2, 'ok', 'Son yedek 2 gün önce'],
    [3, 'warn', 'Son yedek 3 gün önce'],
    [6, 'warn', 'Son yedek 6 gün önce'],
    [7, 'alert', 'Son yedek 7 gün önce, bugün yedek al'],
    [40, 'alert', 'Son yedek 40 gün önce, bugün yedek al'],
  ] as const)('%i gün önce: %s', (daysAgo, level, text) => {
    expect(backupStatus(at(daysAgo), NOW, true)).toEqual({ level, days: daysAgo, text })
  })

  it('gün farkı Türkiye takvimine göredir', () => {
    // 5 Ekim 23:50 ile 6 Ekim 00:10 arası 20 dakika ama takvimde 1 gün
    expect(daysBetween(new Date('2026-10-05T20:50:00.000Z'), new Date('2026-10-05T21:10:00.000Z'))).toBe(1)
    expect(daysBetween(new Date('2026-10-05T21:10:00.000Z'), new Date('2026-10-06T20:50:00.000Z'))).toBe(0)
    // Saat ileri alınmış olsa da eksi gün çıkmaz
    expect(backupStatus(new Date(NOW.getTime() + 3 * 86_400_000).toISOString(), NOW, true).days).toBe(0)
  })

  it('yedekten sonra eklenen veri kayıtlardaki zaman damgalarından sayılır', () => {
    const last = '2026-10-05T12:00:00.000Z'
    const results = [result('a', 'completed', '2026-10-05T11:00:00.000Z'), result('b', 'completed', '2026-10-05T13:00:00.000Z'), result('c', 'completed', '2026-10-06T09:00:00.000Z')]
    const uploads = [{ uploadedAt: '2026-10-04T08:00:00.000Z' }, { uploadedAt: '2026-10-06T08:00:00.000Z' }]
    expect(sinceBackup(last, results, uploads)).toEqual({ scores: 2, uploads: 1 })
    expect(sinceBackup(null, results, uploads)).toBeNull()
  })
})

describe('yedek zamanı yedek dosyasına girmez', () => {
  const content = { uploads: [], matches: [], results: [], picks: [], thresholds: defaultThresholds() }

  it('yedek yalnızca bilinen alanlardan kurulur', () => {
    const smuggled = { ...content, lastBackupAt: '2026-10-01T00:00:00.000Z', settings: [{ key: 'lastBackupAt', value: 'x' }] }
    const file = assembleBackup(smuggled, NOW)
    expect(isBackupFile(file)).toBe(true)
    expect(Object.keys(file).sort()).toEqual(
      ['aiPrompts', 'aiVerdicts', 'app', 'exportedAt', 'leagueTables', 'marketConflictLimit', 'matches', 'picks', 'results', 'sharedPicks', 'storySelections', 'storyTexts', 'teamAliases', 'thresholds', 'uploads', 'version'].sort(),
    )
    expect(JSON.stringify(file)).not.toContain('lastBackupAt')
    expect(file.exportedAt).toBe(NOW.toISOString())
  })

  it('yedek dosyasında böyle bir alan olsa bile dosya biçimi onu tanımaz', () => {
    const file = JSON.parse(JSON.stringify({ ...assembleBackup(content, NOW), lastBackupAt: '2020-01-01T00:00:00.000Z' })) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    // BackupFile tipinde bu alan yoktur; içe aktarma yalnızca tipteki alanları yazar.
    const known: (keyof BackupFile)[] = ['app', 'version', 'exportedAt', 'uploads', 'matches', 'results', 'picks', 'thresholds', 'aiVerdicts', 'aiPrompts', 'storyTexts', 'marketConflictLimit', 'storySelections', 'sharedPicks', 'leagueTables', 'teamAliases']
    expect(known).not.toContain('lastBackupAt')
  })
})

describe('skor bekleyen', () => {
  it('saat biliniyorsa başlangıçtan 2 saat sonra; bilinmiyorsa gün geçince', () => {
    // 15:00 maçı: 16:59'da henüz değil, 17:00'de evet
    expect(isScoreDue(match('a', TODAY, '15:00'), new Date('2026-10-06T13:59:00.000Z'))).toBe(false)
    expect(isScoreDue(match('a', TODAY, '15:00'), new Date('2026-10-06T14:00:00.000Z'))).toBe(true)
    // 23:30 maçı ertesi gün 01:30'da
    expect(isScoreDue(match('a', YESTERDAY, '23:30'), new Date('2026-10-05T22:29:00.000Z'))).toBe(false)
    expect(isScoreDue(match('a', YESTERDAY, '23:30'), new Date('2026-10-05T22:30:00.000Z'))).toBe(true)
    // Saat yok: bugün değil, ertesi gün evet
    expect(isScoreDue(match('a', TODAY, null), NOW)).toBe(false)
    expect(isScoreDue(match('a', YESTERDAY, null), NOW)).toBe(true)
  })

  it('yalnızca önerisi olan, saati geçmiş ve skoru girilmemiş / tamamlanmamış maçlar sayılır', () => {
    const today = day(TODAY, {
      matches: [
        match('gecti', TODAY, '15:00'), // sayılır
        match('tamam', TODAY, '15:00'), // skoru girilmiş
        match('yarim', TODAY, '15:00'), // "tamamlanmadı" bırakılmış: sayılır
        match('ertelendi', TODAY, '15:00'), // beklenmez
        match('iptal', TODAY, '15:00'),
        match('erken', TODAY, '20:00'), // 21:30'da henüz 2 saat geçmedi
        match('onerisiz', TODAY, '12:00'), // önerisi yok
        match('saatsiz', TODAY, null), // gün geçmedi
      ],
      recommendedIds: ['gecti', 'tamam', 'yarim', 'ertelendi', 'iptal', 'erken', 'saatsiz'],
    })
    const results = { tamam: result('tamam'), yarim: result('yarim', 'pending'), ertelendi: result('ertelendi', 'postponed'), iptal: result('iptal', 'cancelled') }
    expect(scoresDue(today, results, NOW)).toBe(2)
    // Bir saat sonra 20:00 maçı da sayılır
    expect(scoresDue(today, results, new Date(NOW.getTime() + 3_600_000))).toBe(3)
  })

  it('dünden kalanlar ayrı sayılır', () => {
    const yesterday = day(YESTERDAY, { matches: [match('d1', YESTERDAY, '21:00'), match('d2', YESTERDAY, null), match('d3', YESTERDAY, '21:00')], recommendedIds: ['d1', 'd2', 'd3'] })
    const today = day(TODAY, { matches: [match('b1', TODAY, '15:00')], recommendedIds: ['b1'] })
    const list = buildChecklist({ now: NOW, today, yesterday, results: { d3: result('d3') }, hasData: true, backup: backupStatus(null, NOW, true) })
    const scores = list.items.find((i) => i.key === 'scores')!
    expect(scores).toMatchObject({ state: 'todo', text: 'Bugün: 1 maç · Dünden kalan: 2', link: { to: '/skor-girisi' } })
  })
})

describe('korner / kart sayısı', () => {
  it('skoru girilmiş ama sayısı girilmediği için değerlendirilemeyen korner ve kart önerileri', () => {
    const picks = [
      pick('a', 'corners85', 'void', TODAY),
      pick('a', 'corners95', 'void', TODAY),
      pick('a', 'cards35', 'void', TODAY),
      pick('b', 'cards45', 'void', YESTERDAY),
      pick('c', 'corners85', 'won', TODAY), // sayısı girilmiş
      pick('d', 'corners85', 'pending', TODAY), // skor henüz yok
      pick('e', 'ht05', 'void', TODAY), // korner/kart değil
    ]
    expect(missingCounts(picks)).toEqual({ picks: 4, matches: 2 })
    expect(missingCounts([])).toEqual({ picks: 0, matches: 0 })
  })
})

describe('paylaşım ve dünün sonucu', () => {
  const sharedToday = [
    ...recordShare([], { date: TODAY, categoryId: 'over25', matches: [match('a', TODAY), match('b', TODAY)], now: NOW.toISOString() }),
    ...recordShare([], { date: TODAY, categoryId: 'btts', matches: [match('a', TODAY)], now: NOW.toISOString() }),
  ]

  it('bugün indirilen görsel (kategori) ve paylaşılan öneri sayısı; çıkarılanlar sayılmaz', () => {
    expect(sharingOf(day(TODAY, { shared: sharedToday }))).toEqual({ categories: 2, picks: 3 })
    const removed = removeShare(sharedToday, TODAY, 'btts', 'a', NOW.toISOString())
    expect(sharingOf(day(TODAY, { shared: removed }))).toEqual({ categories: 1, picks: 2 })
    expect(sharingOf(day(TODAY))).toEqual({ categories: 0, picks: 0 })
    // Başka günün kaydı karışmaz
    expect(sharingOf(day(YESTERDAY, { shared: sharedToday }))).toEqual({ categories: 0, picks: 0 })
  })

  it('dünün paylaşılanları: hepsi sonuçlandıysa hazır, yoksa bekleyen sayısı', () => {
    const shared = recordShare([], { date: YESTERDAY, categoryId: 'over25', matches: [match('a', YESTERDAY), match('b', YESTERDAY), match('c', YESTERDAY)], now: '2026-10-05T09:00:00.000Z' })
    const yesterday = day(YESTERDAY, { shared })
    expect(sharedPending(yesterday, { a: result('a') })).toEqual({ total: 3, pending: 2 })
    expect(sharedPending(yesterday, { a: result('a'), b: result('b', 'pending'), c: result('c', 'postponed') })).toEqual({ total: 3, pending: 1 })
    expect(sharedPending(yesterday, { a: result('a'), b: result('b'), c: result('c', 'cancelled') })).toEqual({ total: 3, pending: 0 })
    expect(sharedPending(day(YESTERDAY), {})).toEqual({ total: 0, pending: 0 })
  })
})

describe('buildChecklist', () => {
  const base = (extra: Partial<ChecklistInput> = {}): ChecklistInput => ({
    now: NOW,
    today: day(TODAY),
    yesterday: day(YESTERDAY),
    results: {},
    hasData: true,
    backup: backupStatus(NOW.toISOString(), NOW, true),
    ...extra,
  })
  const item = (input: ChecklistInput, key: string) => buildChecklist(input).items.find((i) => i.key === key)!

  it('hiç veri yoksa liste boştur (yalnızca "CSV yükle" gösterilir)', () => {
    expect(buildChecklist(base({ hasData: false, backup: backupStatus(null, NOW, false) }))).toEqual({ empty: true, items: [], todo: 0 })
  })

  it('altı madde, sabit sırayla', () => {
    expect(buildChecklist(base()).items.map((i) => i.key)).toEqual(['csv', 'scores', 'counts', 'sharing', 'yesterday', 'backup'])
  })

  it('CSV: bugün için maç yoksa yapılacak; varsa maç sayısı', () => {
    expect(item(base(), 'csv')).toMatchObject({ state: 'todo', text: 'Bugün için CSV yok', link: { to: '/admin' } })
    expect(item(base({ today: day(TODAY, { matches: [match('a', TODAY), match('b', TODAY)] }) }), 'csv')).toMatchObject({ state: 'done', text: '2 maç' })
  })

  it('korner / kart: eksik varsa not çıkar', () => {
    const today = day(TODAY, { picks: [pick('a', 'corners85', 'void', TODAY), pick('a', 'cards35', 'void', TODAY)] })
    expect(item(base({ today }), 'counts')).toMatchObject({ state: 'todo', text: '1 maçta 2 öneri için sayı girilmedi (bugün ve dün)', note: 'Girilmezse bu öneriler değerlendirilemedi kalır.' })
    expect(item(base(), 'counts')).toMatchObject({ state: 'done', note: undefined })
  })

  it('paylaşım: sıfırsa "Bugün görsel indirilmedi"', () => {
    expect(item(base(), 'sharing')).toMatchObject({ state: 'info', text: 'Bugün görsel indirilmedi' })
    const shared = recordShare([], { date: TODAY, categoryId: 'over25', matches: [match('a', TODAY), match('b', TODAY)], now: NOW.toISOString() })
    expect(item(base({ today: day(TODAY, { shared }) }), 'sharing')).toMatchObject({ state: 'done', text: 'Bugün 1 kategoride görsel indirildi, 2 öneri paylaşıldı' })
  })

  it('dünün sonucu: paylaşım yok / bekleyen var / hazır', () => {
    const shared = recordShare([], { date: YESTERDAY, categoryId: 'over25', matches: [match('a', YESTERDAY), match('b', YESTERDAY)], now: '2026-10-05T09:00:00.000Z' })
    const yesterday = day(YESTERDAY, { shared })
    expect(item(base(), 'yesterday')).toMatchObject({ state: 'info', text: 'Dün paylaşılan öneri yok' })
    expect(item(base({ yesterday, results: { a: result('a') } }), 'yesterday')).toMatchObject({ state: 'todo', text: '1 paylaşılan öneri bekliyor', link: { to: '/skor-girisi' } })
    expect(item(base({ yesterday, results: { a: result('a'), b: result('b') } }), 'yesterday')).toMatchObject({
      state: 'done',
      text: 'Dünün sonuç görseli hazırlanabilir',
      link: { to: '/istatistik', label: 'Günlük görsel' },
    })
  })

  it('yedek maddesi yedek durumunu özetler; yapılacak sayısı tutar', () => {
    expect(item(base(), 'backup')).toMatchObject({ state: 'done', text: 'Son yedek bugün alındı' })
    expect(item(base({ backup: backupStatus(null, NOW, true) }), 'backup')).toMatchObject({ state: 'todo', text: 'Henüz yedek almadın.' })
    // Temel durumda: CSV yok (yapılacak), diğerleri tamam ya da bilgi
    expect(buildChecklist(base()).todo).toBe(1)
    expect(buildChecklist(base({ backup: backupStatus(null, NOW, true) })).todo).toBe(2)
  })
})
