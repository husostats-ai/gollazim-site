import { describe, expect, it } from 'vitest'
import { isCategoryId } from '../../config/categories'
import type { Highlight, MatchResult, Pick } from '../../types'
import { assembleBackup, isBackupFile } from '../data/backupFormat'
import { OUTCOME_LABELS } from '../results/evaluator'
import {
  addHighlight,
  byKickoffTime,
  HIGHLIGHT_OUTCOME_LABELS,
  highlightId,
  highlightOutcome,
  kickoffOf,
  lockState,
  normalizeHighlights,
  REFUSAL_TEXTS,
  removeHighlight,
  summarizeHighlights,
  type HighlightCandidate,
} from './highlights'

// "Günün öne çıkanları": kilit, ekle / çıkar, sonuç ve özet sayıları, yedek.

const DAY = '2026-10-08'
const match = (id: string, time?: string, extra: Partial<HighlightCandidate['match']> = {}): HighlightCandidate['match'] => ({ id: `${DAY}|${id}|Rakip`, date: DAY, time, league: 'Testland · Deneme Ligi', home: id, away: 'Rakip', ...extra })
const candidate = (id: string, time: string | undefined, categoryId: HighlightCandidate['categoryId'] = 'over25'): HighlightCandidate => ({ match: match(id, time), categoryId, percent: 82, reliability: 'high' })
// 20:00 TSİ = 17:00 UTC
const BEFORE = new Date('2026-10-08T16:59:59.000Z')
const AT = new Date('2026-10-08T17:00:00.000Z')
const AFTER = new Date('2026-10-08T17:00:01.000Z')
const added = (id: string, time: string, categoryId: HighlightCandidate['categoryId'] = 'over25', now = new Date('2026-10-08T06:00:00.000Z')): Highlight => {
  const result = addHighlight([], candidate(id, time, categoryId), now)
  if (!result.ok) throw new Error(result.reason)
  return result.record
}
const result = (matchId: string, values: Partial<MatchResult> = {}): MatchResult => ({ matchId, status: 'completed', htHome: 1, htAway: 0, ftHome: 2, ftAway: 1, cornersHome: null, cornersAway: null, cardsHome: null, cardsAway: null, updatedAt: '2026-10-08T20:00:00.000Z', ...values })

describe('kilit', () => {
  it('başlama saati Türkiye saatiyle okunur', () => {
    expect(kickoffOf({ date: DAY, time: '20:00' })!.toISOString()).toBe('2026-10-08T17:00:00.000Z')
    expect(kickoffOf({ date: DAY, time: '00:30' })!.toISOString()).toBe('2026-10-07T21:30:00.000Z')
  })

  it('saatten önce açık; tam saatinde ve sonrasında kilitli', () => {
    expect(lockState({ date: DAY, time: '20:00' }, BEFORE)).toBe('open')
    expect(lockState({ date: DAY, time: '20:00' }, AT)).toBe('locked')
    expect(lockState({ date: DAY, time: '20:00' }, AFTER)).toBe('locked')
    // Ertesi günün maçı bugün açıktır; dünün maçı kilitlidir.
    expect(lockState({ date: '2026-10-09', time: '00:05' }, AFTER)).toBe('open')
    expect(lockState({ date: '2026-10-07', time: '23:59' }, BEFORE)).toBe('locked')
  })

  it('saat bilinmiyorsa ya da okunamıyorsa: ne maçtan önce ne sonra eklenebilir', () => {
    for (const time of [undefined, null, '', '20.00', '8:00', 'saat yok']) {
      expect(lockState({ date: DAY, time }, BEFORE), String(time)).toBe('no-time')
      expect(lockState({ date: '2026-12-31', time }, BEFORE), String(time)).toBe('no-time')
    }
  })
})

describe('ekle / çıkar', () => {
  it('kayıt: gün, maç, kategori, eklenme zamanı ve eklenme anındaki görünüm', () => {
    const outcome = addHighlight([], candidate('Kuzey', '20:00'), BEFORE)
    expect(outcome).toEqual({
      ok: true,
      record: { id: `${DAY}|${DAY}|Kuzey|Rakip|over25`, date: DAY, matchId: `${DAY}|Kuzey|Rakip`, categoryId: 'over25', addedAt: '2026-10-08T16:59:59.000Z', home: 'Kuzey', away: 'Rakip', time: '20:00', league: 'Testland · Deneme Ligi', percent: 82, reliability: 'high' },
    })
    // Lig ve güvenilirlik yoksa alan yazılmaz.
    const bare = addHighlight([], { match: match('Kuzey', '20:00', { league: undefined }), categoryId: 'btts', percent: 70 }, BEFORE)
    expect(bare.ok && Object.keys(bare.record).sort()).toEqual(['addedAt', 'away', 'categoryId', 'date', 'home', 'id', 'matchId', 'percent', 'time'])
  })

  it('maç başladıysa eklenemez; saat yoksa eklenemez', () => {
    expect(addHighlight([], candidate('Kuzey', '20:00'), AT)).toEqual({ ok: false, reason: 'locked' })
    expect(addHighlight([], candidate('Kuzey', '20:00'), AFTER)).toEqual({ ok: false, reason: 'locked' })
    expect(addHighlight([], candidate('Kuzey', undefined), BEFORE)).toEqual({ ok: false, reason: 'no-time' })
  })

  it('aynı öneri iki kez eklenmez; aynı maçın başka kategorisi ayrı seçimdir', () => {
    const first = added('Kuzey', '20:00')
    expect(addHighlight([first], candidate('Kuzey', '20:00'), BEFORE)).toEqual({ ok: false, reason: 'exists' })
    const other = addHighlight([first], candidate('Kuzey', '20:00', 'btts'), BEFORE)
    expect(other.ok && other.record.id).toBe(highlightId(DAY, `${DAY}|Kuzey|Rakip`, 'btts'))
  })

  it('kilitlenmeden önce kaldırılır; kilitlendikten sonra kaldırılamaz', () => {
    const record = added('Kuzey', '20:00')
    expect(removeHighlight([record], record.id, BEFORE)).toEqual({ ok: true, record })
    expect(removeHighlight([record], record.id, AT)).toEqual({ ok: false, reason: 'locked' })
    expect(removeHighlight([record], record.id, AFTER)).toEqual({ ok: false, reason: 'locked' })
    expect(removeHighlight([record], 'yok', BEFORE)).toEqual({ ok: false, reason: 'missing' })
    // Saati bozulmuş kayıt (elle düzenlenmiş yedek) silinemez.
    expect(removeHighlight([{ ...record, time: '' }], record.id, BEFORE)).toEqual({ ok: false, reason: 'locked' })
  })

  it('kaldırıp yeniden eklemek yeni eklenme zamanı yazar', () => {
    const early = new Date('2026-10-08T08:00:00.000Z')
    const record = added('Kuzey', '20:00', 'over25', early)
    const again = addHighlight([], candidate('Kuzey', '20:00'), BEFORE)
    expect(again.ok && again.record.id).toBe(record.id)
    expect(again.ok && again.record.addedAt).toBe('2026-10-08T16:59:59.000Z')
  })

  it('ret metinlerinde oran, tutar ya da kupon geçmez', () => {
    for (const text of Object.values(REFUSAL_TEXTS)) expect(text.toLocaleLowerCase('tr')).not.toMatch(/oran|tutar|kupon|bahis/)
  })
})

describe('sonuç ve özet', () => {
  const record = added('Kuzey', '20:00')
  const pick = (outcome: Pick['outcome']): Pick => ({ id: `${record.matchId}|over25`, matchId: record.matchId, categoryId: 'over25', date: DAY, percent: 82, threshold: 75, outcome, frozenAt: '2026-10-08T20:00:00.000Z' })

  it('dondurulmuş öneri varsa onun sonucu kullanılır', () => {
    expect(highlightOutcome(record, pick('won'), result(record.matchId))).toBe('won')
    expect(highlightOutcome(record, pick('lost'), result(record.matchId))).toBe('lost')
    // Dondurulmuş sonuç, skordan yeniden hesaplanmaz.
    expect(highlightOutcome(record, pick('lost'), result(record.matchId, { ftHome: 5, ftAway: 4 }))).toBe('lost')
  })

  it('dondurulmuş öneri yoksa mevcut değerlendirme fonksiyonu; skor yoksa bekliyor', () => {
    expect(highlightOutcome(record, undefined, undefined)).toBe('pending')
    expect(highlightOutcome(record, undefined, result(record.matchId))).toBe('won') // 2-1: 2.5 üst
    expect(highlightOutcome(record, undefined, result(record.matchId, { ftHome: 1, ftAway: 0 }))).toBe('lost')
    expect(highlightOutcome(record, undefined, result(record.matchId, { status: 'postponed' }))).toBe('pending')
    // Korner sayısı girilmemiş: değerlendirilemedi
    expect(highlightOutcome({ categoryId: 'corners85' }, undefined, result(record.matchId))).toBe('void')
  })

  it('özet: seçilen = tutan + tutmayan + bekleyen + değerlendirilemeyen', () => {
    expect(summarizeHighlights([])).toEqual({ selected: 0, won: 0, lost: 0, pending: 0, void: 0 })
    const summary = summarizeHighlights(['won', 'won', 'lost', 'pending', 'pending', 'pending', 'void'])
    expect(summary).toEqual({ selected: 7, won: 2, lost: 1, pending: 3, void: 1 })
    expect(summary.won + summary.lost + summary.pending + summary.void).toBe(summary.selected)
  })

  it('kaldırılan seçim sayılmaz: özet yalnızca kalan kayıtlardan', () => {
    const a = added('Kuzey', '20:00')
    const b = added('Güney', '21:00')
    const removed = removeHighlight([a, b], a.id, BEFORE)
    const left = [a, b].filter((h) => !(removed.ok && h.id === removed.record.id))
    expect(summarizeHighlights(left.map((h) => highlightOutcome(h, undefined, undefined)))).toMatchObject({ selected: 1, pending: 1 })
  })

  it('bu bölümün sonuç etiketleri "Tuttu / Tutmadı"dır; admin\'in diğer rozet metinleri değişmedi', () => {
    expect(HIGHLIGHT_OUTCOME_LABELS).toEqual({ won: 'Tuttu', lost: 'Tutmadı', void: 'Değerlendirilemedi', pending: 'Bekliyor' })
    expect(OUTCOME_LABELS).toEqual({ won: 'KAZANDI ✅', lost: 'KAYBETTİ ❌', void: 'DEĞERLENDİRİLEMEDİ', pending: 'BEKLİYOR' })
  })

  it('liste saat sırasındadır', () => {
    const rows = [added('Zirve', '21:00'), added('Kuzey', '20:00', 'btts'), added('Ada', '20:00')]
    expect(rows.sort(byKickoffTime).map((h) => `${h.time} ${h.home}`)).toEqual(['20:00 Ada', '20:00 Kuzey', '21:00 Zirve'])
  })
})

describe('yedek', () => {
  const content = { uploads: [], matches: [], results: [], picks: [], thresholds: {} as never }
  const records = [added('Kuzey', '20:00'), added('Güney', '21:00', 'btts')]

  it('seçimler yedeğe girer ve geri okunur', () => {
    const backup = JSON.parse(JSON.stringify(assembleBackup({ ...content, highlights: records }, new Date('2026-10-08T18:00:00.000Z'))))
    expect(isBackupFile(backup)).toBe(true)
    expect(backup.version).toBe(1)
    expect(normalizeHighlights(backup.highlights, isCategoryId)).toEqual(records)
  })

  it('seçim yokken yedekte alan yoktur; alanı olmayan eski yedek geçerlidir ve seçim getirmez', () => {
    for (const highlights of [undefined, []]) expect('highlights' in assembleBackup({ ...content, highlights }, new Date())).toBe(false)
    const old = JSON.parse(JSON.stringify(assembleBackup(content, new Date())))
    expect(isBackupFile(old)).toBe(true)
    expect(normalizeHighlights(old.highlights, isCategoryId)).toEqual([])
    expect(isBackupFile({ ...old, highlights: 'x' })).toBe(false)
  })

  it('bozuk satırlar atılır; kimlik alanlardan yeniden kurulur', () => {
    const [good] = records
    const rows = [
      good,
      { ...good, id: 'uydurma' },
      { ...good, categoryId: 'yok' },
      { ...good, matchId: 5 },
      { ...good, time: '' },
      { ...good, percent: 'x' },
      { ...good, addedAt: 'dün' },
      { ...records[1], reliability: 'uydurma', league: 7 },
      null,
      'metin',
    ]
    const clean = normalizeHighlights(rows, isCategoryId)
    expect(clean.map((h) => h.id)).toEqual([good.id, records[1].id])
    expect(clean[0]).toEqual(good)
    expect('reliability' in clean[1] || 'league' in clean[1]).toBe(false)
    expect(normalizeHighlights('x', isCategoryId)).toEqual([])
  })
})
