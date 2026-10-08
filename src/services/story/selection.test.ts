import { describe, expect, it } from 'vitest'
import { defaultThresholds, isCategoryId } from '../../config/categories'
import type { AiVerdict, BackupFile, StorySelection } from '../../types'
import { analyzeCategory, analyzeDay } from '../analysis/engine'
import { makeMatch } from '../analysis/testUtils'
import { isBackupFile } from '../data/backupFormat'
import { storyFromAnalysis } from '../image/storyGenerator'
import {
  majorityApprovedIds,
  normalizeSelections,
  resolveSelection,
  selectAll,
  selectionId,
  selectionsForDate,
  toggleSelection,
} from './selection'

const a = makeMatch({ over25Pct: 80, bttsPct: 90 }, { id: 'a', time: '20:00' })
const b = makeMatch({ over25Pct: 95, bttsPct: 85 }, { id: 'b', time: '18:00' })
const c = makeMatch({ over25Pct: 88 }, { id: 'c', time: '21:00' })
const weak = makeMatch({ over25Pct: 40 }, { id: 'weak' })
const list = (threshold = 75) => analyzeCategory([a, b, c, weak], 'over25', threshold).predictions
const ids = (predictions: { match: { id: string } }[]) => predictions.map((p) => p.match.id)

describe('resolveSelection', () => {
  it('varsayılan: hiçbir maç seçili değildir', () => {
    expect(resolveSelection(list())).toEqual({ selected: [], missing: 0 })
    expect(resolveSelection(list(), [])).toEqual({ selected: [], missing: 0 })
  })

  it('yalnızca işaretlenen maçlar girer; sıra işaretleme sırası değil listedeki sıradır', () => {
    expect(ids(list())).toEqual(['b', 'c', 'a'])
    expect(ids(resolveSelection(list(), ['a', 'b']).selected)).toEqual(['b', 'a'])
    expect(ids(resolveSelection(list(), ['a', 'c', 'b']).selected)).toEqual(['b', 'c', 'a'])
    expect(ids(resolveSelection(list(), ['c']).selected)).toEqual(['c'])
  })

  it('tümü seçiliyken görsel verisi eski "tüm liste" çıktısıyla aynıdır', () => {
    const analysis = analyzeCategory([a, b, c, weak], 'over25', 75)
    const all = resolveSelection(analysis.predictions, selectAll(analysis.predictions)).selected
    expect(storyFromAnalysis({ ...analysis, predictions: all }, '5 Ekim 2026 Pazartesi')).toEqual(
      storyFromAnalysis(analysis, '5 Ekim 2026 Pazartesi'),
    )
  })

  it('temkinli sırada gösterilen listeden seçilse de görsel yüzdeye göre sıralanır', () => {
    const cautious = analyzeCategory([a, b, c], 'over25', 75, 'cautious').predictions
    const percent = analyzeCategory([a, b, c], 'over25', 75, 'percent').predictions
    expect(ids(resolveSelection(cautious, selectAll(cautious)).selected)).toEqual(ids(percent))
  })

  it('listeden düşen seçili maç görsele girmez ve sayılır', () => {
    // Eşik 85 olunca "a" (%80) listeden düşer
    const result = resolveSelection(list(85), ['a', 'b', 'c'])
    expect(ids(result.selected)).toEqual(['b', 'c'])
    expect(result.missing).toBe(1)
    // Silinmiş maç ve eşik altı maç
    expect(resolveSelection(list(), ['silindi', 'weak', 'b'])).toMatchObject({ missing: 2 })
    // Eşik geri alınınca seçim geri gelir
    expect(resolveSelection(list(75), ['a', 'b', 'c']).missing).toBe(0)
  })

  it('15 maçlık liste ve tek maç seçimi', () => {
    const many = Array.from({ length: 20 }, (_, i) => makeMatch({ over25Pct: 99 - i }, { id: `x${i}` }))
    const predictions = analyzeCategory(many, 'over25', 75).predictions
    expect(predictions).toHaveLength(15)
    expect(resolveSelection(predictions, selectAll(predictions)).selected).toHaveLength(15)
    expect(ids(resolveSelection(predictions, ['x7']).selected)).toEqual(['x7'])
    // İlk 15'e giremeyen maç seçilemez; seçiliyse "listede değil" sayılır
    expect(resolveSelection(predictions, ['x19'])).toMatchObject({ selected: [], missing: 1 })
  })
})

describe('seçim işlemleri', () => {
  it('işaretleme ekler, tekrar işaretleme çıkarır; girdi değişmez', () => {
    const start = ['a']
    expect(toggleSelection(start, 'b')).toEqual(['a', 'b'])
    expect(toggleSelection(start, 'a')).toEqual([])
    expect(toggleSelection(undefined, 'a')).toEqual(['a'])
    expect(start).toEqual(['a'])
  })

  it('tümünü seç listedeki tüm maçları verir', () => {
    expect(selectAll(list())).toEqual(['b', 'c', 'a'])
  })

  it('çoğunluk kararı Onay (eski maç geneli kararlar): kategoride karar yoksa eski kararlara bakılır', () => {
    const verdict = (matchId: string, provider: AiVerdict['provider'], decision: AiVerdict['decision']): AiVerdict => ({
      id: `${matchId}|${provider}`,
      matchId,
      date: '2026-10-05',
      provider,
      decision,
      reason: '',
      risk: '',
      savedAt: '',
    })
    const verdicts = [
      verdict('a', 'chatgpt', 'strong'),
      verdict('a', 'gemini', 'strong'), // ortak, onay
      verdict('b', 'chatgpt', 'strong'),
      verdict('b', 'gemini', 'medium'), // ikisi de onay ama karar aynı değil
      verdict('c', 'chatgpt', 'reject'),
      verdict('c', 'gemini', 'reject'), // ortak ama onay değil
      verdict('weak', 'chatgpt', 'strong'),
      verdict('weak', 'gemini', 'strong'), // listede değil
    ]
    expect(majorityApprovedIds(list(), verdicts, 'over25')).toEqual(['a'])
    expect(majorityApprovedIds(list(), [verdict('a', 'chatgpt', 'strong')], 'over25')).toEqual([])
    expect(majorityApprovedIds(list(), [], 'over25')).toEqual([])
    // Claude'lu gün: 2/3 çoğunluk onaysa seçilir; çoğunluk onay değilse ya da üç karar farklıysa seçilmez
    const three = [
      ...verdicts,
      verdict('a', 'claude', 'reject'), // 2/3 Güçlü
      verdict('b', 'claude', 'medium'), // 2/3 Orta
      verdict('c', 'claude', 'strong'), // 2/3 Eleme
    ]
    expect(majorityApprovedIds(list(), three, 'over25').sort()).toEqual(['a', 'b'])
    expect(majorityApprovedIds(list(), [verdict('a', 'chatgpt', 'strong'), verdict('a', 'gemini', 'medium'), verdict('a', 'claude', 'weak')], 'over25')).toEqual([])
  })

  it('çoğunluk kararı Onay (kategori bazlı): listenin kendi kategorisinin kararına bakılır', () => {
    const fresh = (matchId: string, provider: AiVerdict['provider'], byCategory: AiVerdict['byCategory']): AiVerdict => ({ id: `${matchId}|${provider}`, matchId, date: '2026-10-05', provider, byCategory, reason: '', risk: '', savedAt: '' })
    const all = (matchId: string, byCategory: AiVerdict['byCategory']) => (['chatgpt', 'gemini', 'claude'] as const).map((p) => fresh(matchId, p, byCategory))
    const verdicts = [
      ...all('a', { over25: 'strong', btts: 'reject' }), // 2.5 ÜST onay, KG VAR eleme
      ...all('b', { over25: 'weak', btts: 'medium' }), // 2.5 ÜST onay değil, KG VAR onay
      fresh('c', 'chatgpt', { over25: 'strong' }), // tek karar: çoğunluk yok
    ]
    expect(majorityApprovedIds(list(), verdicts, 'over25')).toEqual(['a'])
    expect(majorityApprovedIds(list(), verdicts, 'btts')).toEqual(['b'])
    // Karar istenmeyen listede kategori kararı yoktur.
    expect(majorityApprovedIds(list(), verdicts, 'corners85')).toEqual([])
    // Kategoride karar varken, saklanan eski maç geneli karar dikkate alınmaz.
    const kept = all('b', { over25: 'weak' }).map((v) => ({ ...v, decision: 'strong' as const }))
    expect(majorityApprovedIds(list(), kept, 'over25')).toEqual([])
    expect(majorityApprovedIds(list(), kept, 'btts')).toEqual(['b'])
  })
})

describe('gün ve kategori ayrımı', () => {
  const row = (date: string, categoryId: StorySelection['categoryId'], matchIds: string[]): StorySelection => ({
    id: selectionId(date, categoryId),
    date,
    categoryId,
    matchIds,
  })
  const rows = [row('2026-10-05', 'over25', ['a', 'b']), row('2026-10-05', 'btts', ['b']), row('2026-10-06', 'over25', ['c'])]

  it('kimlik gün + kategoridir', () => {
    expect(selectionId('2026-10-05', 'over25')).toBe('2026-10-05|over25')
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })

  it('başka günün seçimi karışmaz', () => {
    expect(selectionsForDate(rows, '2026-10-05')).toEqual({ over25: ['a', 'b'], btts: ['b'] })
    expect(selectionsForDate(rows, '2026-10-06')).toEqual({ over25: ['c'] })
    expect(selectionsForDate(rows, '2026-10-07')).toEqual({})
  })

  it('başka kategorinin seçimi karışmaz', () => {
    const day = selectionsForDate(rows, '2026-10-05')
    const analysis = analyzeDay([a, b, c], defaultThresholds())
    expect(ids(resolveSelection(analysis.over25.predictions, day.over25).selected)).toEqual(['b', 'a'])
    expect(ids(resolveSelection(analysis.btts.predictions, day.btts).selected)).toEqual(['b'])
    expect(resolveSelection(analysis.ht05.predictions, day.ht05)).toEqual({ selected: [], missing: 0 })
  })

  it('seçim analizi değiştirmez', () => {
    const before = JSON.stringify(analyzeDay([a, b, c], defaultThresholds()))
    const analysis = analyzeDay([a, b, c], defaultThresholds())
    resolveSelection(analysis.over25.predictions, ['a', 'c'])
    expect(JSON.stringify(analysis)).toBe(before)
  })
})

describe('yedek ve geri yükleme', () => {
  const backup = (extra: Partial<BackupFile>): unknown => ({
    app: 'gollazim',
    version: 1,
    exportedAt: '2026-10-06T00:00:00Z',
    uploads: [],
    matches: [],
    results: [],
    picks: [],
    thresholds: defaultThresholds(),
    ...extra,
  })
  const saved: StorySelection[] = [
    { id: '2026-10-05|over25', date: '2026-10-05', categoryId: 'over25', matchIds: ['a', 'b'] },
    { id: '2026-10-06|homeWin15', date: '2026-10-06', categoryId: 'homeWin15', matchIds: ['c'] },
  ]

  it('seçimler yedekten aynen geri gelir', () => {
    const file = JSON.parse(JSON.stringify(backup({ storySelections: saved }))) as BackupFile
    expect(isBackupFile(file)).toBe(true)
    expect(normalizeSelections(file.storySelections, isCategoryId)).toEqual(saved)
  })

  it('seçimi olmayan eski yedek geçerlidir ve hiçbir maç seçili gelmez', () => {
    expect(isBackupFile(backup({}))).toBe(true)
    expect(normalizeSelections(undefined, isCategoryId)).toEqual([])
    expect(isBackupFile(backup({ storySelections: 'x' as never }))).toBe(false)
  })

  it('bozuk kayıtlar atılır, kimlik yeniden kurulur, tekrarlar teklenir', () => {
    const dirty = [
      { id: 'yanlis', date: '2026-10-05', categoryId: 'over25', matchIds: ['a', 'a', 5, 'b'] },
      { date: '2026-10-05', categoryId: 'bilinmeyen', matchIds: ['a'] },
      { date: '2026-10-05', categoryId: 'btts', matchIds: [] },
      { date: 20261005, categoryId: 'btts', matchIds: ['a'] },
      null,
    ]
    expect(normalizeSelections(dirty, isCategoryId)).toEqual([
      { id: '2026-10-05|over25', date: '2026-10-05', categoryId: 'over25', matchIds: ['a', 'b'] },
    ])
  })
})
