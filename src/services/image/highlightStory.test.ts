import { describe, expect, it } from 'vitest'
import type { PickOutcome } from '../../types'
import { summarizeHighlights } from '../highlights/highlights'
import { drawHighlightStory, HIGHLIGHT_STORY_NOTE, HIGHLIGHT_STORY_PAGE_SIZE, highlightStoryFileName, highlightStoryPages, highlightSummaryText, type HighlightStoryKind, type HighlightStoryRow } from './highlightStory'
import { recordingContext, serializeCalls } from './recordingContext'
import { SAFE_AREA, STORY } from './storyLayout'

// "Öne çıkanlar" görselleri. Gerçek tuval yoktur; tuvale yapılan çağrılar ve yazılan metinler kaydedilir.

const TEAMS = ['Galatasaray', 'Fenerbahçe', 'Peterborough United', 'Bosnia Herzegovina U21', 'İstanbul Başakşehir', 'Ipswich Town U21']
const CATEGORIES = ['2.5 ÜST', 'KG VAR', 'İLK YARI 0.5 ÜST', 'KORNER 8.5 ÜST', 'EV KAZANIR & 1.5 ÜST']
const OUTCOMES: PickOutcome[] = ['won', 'lost', 'pending', 'won', 'void']
const rows = (count: number): HighlightStoryRow[] =>
  Array.from({ length: count }, (_, i) => {
    const outcome = OUTCOMES[i % OUTCOMES.length]
    return { home: TEAMS[i % TEAMS.length], away: TEAMS[(i + 3) % TEAMS.length], time: `${String(12 + (i % 10)).padStart(2, '0')}:${i % 2 ? '45' : '00'}`, categoryLabel: CATEGORIES[i % CATEGORIES.length], score: outcome === 'pending' ? null : `İY ${i % 2}-0 · MS ${1 + (i % 3)}-${i % 2}`, outcome }
  })
const pagesOf = (kind: HighlightStoryKind, count: number) => {
  const list = rows(count)
  return highlightStoryPages(kind, '8 Ekim 2026', list, summarizeHighlights(list.map((r) => r.outcome)))
}
const draw = (kind: HighlightStoryKind, count: number, page = 0) => {
  const { ctx, calls, texts } = recordingContext()
  drawHighlightStory(ctx, pagesOf(kind, count)[page], null)
  return { calls: serializeCalls(calls), texts, all: texts.map((t) => t.text) }
}

describe('görsellere bölme', () => {
  it("15'e kadar tek görsel; fazlası 15'erli parçalara bölünür, sıra numarası devam eder", () => {
    expect(HIGHLIGHT_STORY_PAGE_SIZE).toBe(15)
    expect(pagesOf('list', 0).map((p) => [p.page, p.pages, p.rows.length, p.total])).toEqual([[1, 1, 0, 0]])
    expect(pagesOf('list', 15).map((p) => [p.page, p.pages, p.rows.length])).toEqual([[1, 1, 15]])
    expect(pagesOf('results', 16).map((p) => [p.page, p.pages, p.rows.length, p.firstRank, p.total])).toEqual([
      [1, 2, 15, 1, 16],
      [2, 2, 1, 16, 16],
    ])
    expect(pagesOf('list', 31).map((p) => p.rows.length)).toEqual([15, 15, 1])
    // Özet bölünmüş her görselde günün tamamının özetidir.
    expect(new Set(pagesOf('results', 31).map((p) => JSON.stringify(p.summary))).size).toBe(1)
  })

  it('dosya adları', () => {
    const [single] = pagesOf('list', 3)
    expect(highlightStoryFileName(single, '2026-10-08')).toBe('gollazim-one-cikanlar-2026-10-08.png')
    expect(highlightStoryFileName({ ...single, kind: 'results' }, '2026-10-08')).toBe('gollazim-one-cikanlar-sonuc-2026-10-08.png')
    expect(pagesOf('results', 16).map((p) => highlightStoryFileName(p, '2026-10-08'))).toEqual(['gollazim-one-cikanlar-sonuc-2026-10-08-1.png', 'gollazim-one-cikanlar-sonuc-2026-10-08-2.png'])
  })
})

describe('"Günün Öne Çıkanları" görseli', () => {
  it('maç, saat ve kategori yazar; sıra numarası vardır', () => {
    const { all } = draw('list', 4)
    expect(all).toEqual(expect.arrayContaining(['8 EKİM 2026', 'ÖNE ÇIKANLAR', 'GÜNÜN SEÇİMLERİ', '4 seçim  •  Saatler TSİ', 'Galatasaray', 'Bosnia Herzegovina U21', '12:00', '2.5 ÜST', '13:45', 'KG VAR', '1', '4']))
  })

  it('skor, sonuç ve özet yazmaz', () => {
    const { all } = draw('list', 4)
    expect(all.join(' | ')).not.toMatch(/MS|İY \d|Tuttu|Tutmadı|Bekliyor|Seçilen|Tutan/)
  })
})

describe('"Öne Çıkanlar Sonuçları" görseli', () => {
  it('skor, Tuttu / Tutmadı ve özet yazar', () => {
    const { all } = draw('results', 4)
    expect(all).toEqual(expect.arrayContaining(['ÖNE ÇIKANLAR', 'SONUÇLARI', 'Seçilen 4  ·  Tutan 2  ·  Tutmayan 1  ·  Bekleyen 1', '1-0', '2.5 ÜST  ·  Tuttu', 'KG VAR  ·  Tutmadı']))
  })

  it('bekleyen seçim "Bekliyor" etiketi ve skorsuz (—) görünür; özette sayılır', () => {
    const { all } = draw('results', 4)
    expect(all).toContain('İLK YARI 0.5 ÜST  ·  Bekliyor')
    expect(all).toContain('—')
    // Sıkışık düzende (çok satır) de etiket kaybolmaz.
    expect(draw('results', 15).all).toEqual(expect.arrayContaining(['İLK YARI 0.5 ÜST · Bekliyor', 'EV KAZANIR & 1.5 ÜST · Değerlendirilemedi']))
    expect(highlightSummaryText({ selected: 7, won: 2, lost: 1, pending: 3, void: 1 })).toBe('Seçilen 7  ·  Tutan 2  ·  Tutmayan 1  ·  Bekleyen 3  ·  Değerlendirilemeyen 1')
    expect(highlightSummaryText({ selected: 3, won: 2, lost: 1, pending: 0, void: 0 })).toBe('Seçilen 3  ·  Tutan 2  ·  Tutmayan 1  ·  Bekleyen 0')
  })

  it('bölünmüş görselde "1/2" yazar ve özet günün tamamıdır', () => {
    const second = draw('results', 16, 1)
    expect(second.all).toEqual(expect.arrayContaining(['16 seçim  •  Saatler TSİ  •  2/2']))
    expect(second.all.find((t) => t.startsWith('Seçilen'))).toContain('Seçilen 16')
  })
})

describe('iki görselde ortak kurallar', () => {
  const cases: [HighlightStoryKind, number][] = [
    ['list', 0],
    ['list', 1],
    ['list', 4],
    ['list', 15],
    ['results', 1],
    ['results', 4],
    ['results', 15],
  ]

  it.each(cases)('%s, %i seçim: not yazılı; yüzde, güvenilirlik ve yasak sözcük yok; güvenli alanda', (kind, count) => {
    const { texts, all } = draw(kind, count)
    expect(all).toContain(HIGHLIGHT_STORY_NOTE)
    expect(HIGHLIGHT_STORY_NOTE).toBe('İstatistik taramasıdır, bahis tavsiyesi değildir.')
    const joined = all.join(' | ')
    expect(joined).not.toContain('%')
    expect(joined.toLocaleLowerCase('tr')).not.toMatch(/güvenilirlik|oran|tutar|kupon|oyna|yıldız|garanti/)
    for (const t of texts) {
      expect(t.y, t.text).toBeGreaterThanOrEqual(SAFE_AREA.top)
      expect(t.y, t.text).toBeLessThanOrEqual(SAFE_AREA.bottom)
      const left = t.align === 'right' ? t.x - t.width : t.align === 'center' ? t.x - t.width / 2 : t.x
      expect(left, t.text).toBeGreaterThanOrEqual(0)
      expect(left + t.width, t.text).toBeLessThanOrEqual(STORY.width)
    }
  })

  it('düzenlenebilir uyarı metni değişse de sabit not yazılır', () => {
    const { ctx, texts } = recordingContext()
    drawHighlightStory(ctx, pagesOf('list', 3)[0], null, { telegram: 'https://t.me/x', instagram: '@x', disclaimer: 'Başka bir metin' } as never)
    const all = texts.map((t) => t.text)
    expect(all).toContain(HIGHLIGHT_STORY_NOTE)
    expect(all.join(' | ')).not.toContain('Başka bir metin')
  })

  it.each(cases)('çizim kaydı: %s, %i seçim', (kind, count) => {
    expect(draw(kind, count).calls).toMatchSnapshot()
  })
})
