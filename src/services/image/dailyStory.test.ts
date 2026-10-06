import { describe, expect, it } from 'vitest'
import { DEFAULT_STORY_TEXTS, normalizeStoryTexts, type StoryTexts } from '../../config/storyTexts'
import type { Pick, PickOutcome } from '../../types'
import { buildDailySummary, DAILY_CATEGORY_IDS, type DailySummary } from '../stats/dailySummary'
import { DAILY_LAYOUT, DAILY_SAFE_AREA, DAILY_TEXT, drawDailyStory, overallSentence } from './dailyStory'
import { recordingContext, serializeCalls, type Call } from './recordingContext'
import { STORY, wrapText } from './storyLayout'

// Gerçek PNG tarayıcıda denenir; burada tuval çağrıları kaydedilir (bkz. storyDraw.test.ts).
// Tasarım bilerek değiştirildiyse kayıt `npx vitest run -u` ile yenilenir.

const DAY = '2026-10-05'
let n = 0
const picks = (count: number, outcome: PickOutcome, categoryId: Pick['categoryId']): Pick[] =>
  Array.from({ length: count }, () => ({
    id: `p${++n}`,
    matchId: `m${n}`,
    categoryId,
    date: DAY,
    percent: 80,
    threshold: 75,
    outcome,
    frozenAt: '2026-10-05T21:00:00Z',
  }))

const normal = buildDailySummary(
  [
    ...picks(4, 'won', 'over25'),
    ...picks(6, 'lost', 'over25'),
    ...picks(7, 'won', 'ht05'),
    ...picks(1, 'lost', 'ht05'),
    ...picks(9, 'won', 'sh05'),
    ...picks(1, 'lost', 'sh05'),
    ...picks(3, 'lost', 'over25btts'),
    // KG Var: o gün öneri yok
  ],
  DAY,
)
const empty = buildDailySummary([], DAY)
const widest = buildDailySummary(DAILY_CATEGORY_IDS.flatMap((id) => picks(120, 'won', id)), DAY)

const draw = (summary: DailySummary, texts?: StoryTexts, dateLabel = '5 Ekim 2026') => {
  const recorded = recordingContext()
  drawDailyStory(recorded.ctx, summary, dateLabel, null, texts)
  return recorded
}

/** Arka plan dışındaki çizimlerin dikey sınırları */
const verticalExtent = (calls: Call[]) => {
  const ys: number[] = []
  for (const [name, ...args] of calls as [string, ...number[]][]) {
    if (name === 'fillRect' && args[2] === STORY.width && args[3] === STORY.height) continue
    if (name === 'fillRect') ys.push(args[1], args[1] + args[3])
    if (name === 'moveTo') ys.push(args[1])
    if (name === 'arcTo') ys.push(args[1], args[3])
  }
  return { top: Math.min(...ys), bottom: Math.max(...ys) }
}

const LONG: StoryTexts = {
  telegram: 'https://t.me/gollazimanaliz_cok_uzun_bir_kanal_adi_ve_davet_baglantisi_2026',
  instagram: '@gollazim.analiz.resmi.hesap.istatistik',
  disclaimer:
    'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir ve sonuç garantisi vermez. Geçmiş sonuçlar gelecekteki sonuçların göstergesi değildir. 18+',
}
const NONE: StoryTexts = { telegram: '', instagram: '', disclaimer: '' }

describe('drawDailyStory çizim kaydı', () => {
  it('normal gün (bir kategori boş)', () => expect(serializeCalls(draw(normal).calls)).toMatchSnapshot())
  it('boş gün', () => expect(serializeCalls(draw(empty).calls)).toMatchSnapshot())
})

describe('drawDailyStory yerleşimi', () => {
  const cases: [string, DailySummary, StoryTexts | undefined, string?][] = [
    ['normal gün', normal, undefined],
    ['boş gün', empty, undefined],
    ['en geniş değerler', widest, undefined, '26 Eylül 2026'],
    ['uzun alt metinler', widest, LONG, '26 Eylül 2026'],
    ['alt metinler boş', normal, NONE],
  ]

  it.each(cases)('%s: her şey güvenli alanın (250–1670 px) ve yan boşlukların içinde', (_, summary, texts, dateLabel) => {
    const { calls, texts: drawn } = draw(summary, texts, dateLabel)
    const shapes = verticalExtent(calls)
    expect(shapes.top).toBeGreaterThanOrEqual(DAILY_SAFE_AREA.top)
    expect(shapes.bottom).toBeLessThanOrEqual(DAILY_SAFE_AREA.bottom)
    for (const t of drawn) {
      // Büyük harf yüksekliği boyutun ~%73'ü, kuyruklu harfler taban çizgisinin ~%22 altına iner.
      expect(t.y - t.size * 0.73, t.text).toBeGreaterThanOrEqual(DAILY_SAFE_AREA.top)
      expect(t.y + t.size * 0.22, t.text).toBeLessThanOrEqual(DAILY_SAFE_AREA.bottom)
      const [from, to] = t.align === 'right' ? [t.x - t.width, t.x] : [t.x, t.x + t.width]
      expect(from, t.text).toBeGreaterThanOrEqual(DAILY_LAYOUT.left)
      expect(to, t.text).toBeLessThanOrEqual(DAILY_LAYOUT.right)
    }
  })

  it.each(cases)('%s: okunabilirlik alt sınırları korunur', (_, summary, texts, dateLabel) => {
    const { texts: drawn } = draw(summary, texts, dateLabel)
    const sizeOf = (match: (text: string) => boolean) => drawn.filter((t) => match(t.text)).map((t) => t.size)
    const used = texts ?? DEFAULT_STORY_TEXTS
    for (const size of sizeOf((t) => t === '2.5 ÜST' || t === 'İLK YARI 0.5 ÜST' || t === '2.5 ÜST & KG VAR')) expect(size).toBeGreaterThanOrEqual(44)
    for (const size of sizeOf((t) => /^%\d+$/.test(t))) expect(size).toBeGreaterThanOrEqual(64)
    for (const size of sizeOf((t) => DAILY_TEXT.note.startsWith(t))) expect(size).toBeGreaterThanOrEqual(26)
    for (const size of sizeOf((t) => t === DAILY_TEXT.telegram || t === DAILY_TEXT.instagram)) expect(size).toBeGreaterThanOrEqual(26)
    if (used.disclaimer) for (const size of sizeOf((t) => used.disclaimer.startsWith(t))) expect(size).toBeGreaterThanOrEqual(22)
  })

  it('kategori kartları birbirine ve alt bloğa binmez', () => {
    for (const [, summary, texts] of cases) {
      const { texts: drawn } = draw(summary, texts)
      const labels = drawn.filter((t) => ['2.5 ÜST', 'İLK YARI 0.5 ÜST', '2. YARI 0.5 ÜST', 'KG VAR', '2.5 ÜST & KG VAR'].includes(t.text))
      expect(labels.map((t) => t.text)).toEqual(['2.5 ÜST', 'İLK YARI 0.5 ÜST', '2. YARI 0.5 ÜST', 'KG VAR', '2.5 ÜST & KG VAR'])
      const step = labels[1].y - labels[0].y
      expect(step).toBeGreaterThanOrEqual(DAILY_LAYOUT.rows.minHeight + DAILY_LAYOUT.rows.gap)
      const note = drawn.find((t) => DAILY_TEXT.note.startsWith(t.text))!
      // Son kartın alt kenarı notun üstünde kalır.
      expect(labels[4].y + step * 0.5).toBeLessThan(note.y - note.size)
    }
  })

  it('boş bırakılan alt metnin satırı hiç çizilmez', () => {
    const all = draw(normal).texts.map((t) => t.text)
    expect(all).toEqual(expect.arrayContaining([DAILY_TEXT.telegram, DEFAULT_STORY_TEXTS.telegram, DAILY_TEXT.instagram, DEFAULT_STORY_TEXTS.instagram]))
    expect(all.some((t) => DEFAULT_STORY_TEXTS.disclaimer.startsWith(t))).toBe(true)

    const none = draw(normal, NONE).texts.map((t) => t.text)
    expect(none).not.toContain(DAILY_TEXT.telegram)
    expect(none).not.toContain(DAILY_TEXT.instagram)
    expect(none.some((t) => DEFAULT_STORY_TEXTS.disclaimer.startsWith(t))).toBe(false)

    const onlyInstagram = draw(normal, { ...NONE, instagram: '@gollazim' }).texts.map((t) => t.text)
    expect(onlyInstagram).toContain(DAILY_TEXT.instagram)
    expect(onlyInstagram).not.toContain(DAILY_TEXT.telegram)
  })

  it('genel kart gerçek sayıları yazar; veri yoksa sayı uydurmaz', () => {
    expect(overallSentence(normal.overall)).toBe('31 önerinin 20 tanesi tuttu')
    expect(draw(normal).texts.map((t) => t.text)).toEqual(expect.arrayContaining(['%65', '31 önerinin 20 tanesi tuttu', 'GENEL İSABET', '4/10', '%40']))
    const texts = draw(empty).texts.map((t) => t.text)
    expect(texts).toContain(DAILY_TEXT.noDecided)
    expect(texts.filter((t) => t === '—')).toHaveLength(6)
    expect(texts.some((t) => /\d+\/\d+|^%\d/.test(t))).toBe(false)
  })
})

describe('normalizeStoryTexts', () => {
  it('kayıt yoksa varsayılanları, kayıtlı boş metni ise boş olarak verir', () => {
    expect(normalizeStoryTexts(undefined)).toEqual(DEFAULT_STORY_TEXTS)
    expect(normalizeStoryTexts({ telegram: '', instagram: ' @x ' })).toEqual({ telegram: '', instagram: '@x', disclaimer: DEFAULT_STORY_TEXTS.disclaimer })
    expect(normalizeStoryTexts({ telegram: 5 })).toEqual(DEFAULT_STORY_TEXTS)
  })
})

describe('wrapText', () => {
  const measure = (text: string) => [...text].length * 10
  it('sözcük aralarından böler, her satır genişliğe sığar', () => {
    expect(wrapText('bir iki üç dört beş', 90, measure)).toEqual(['bir iki', 'üç dört', 'beş'])
    expect(wrapText('kısa', 90, measure)).toEqual(['kısa'])
    expect(wrapText('', 90, measure)).toEqual([])
    expect(wrapText('çokuzunbirsözcük ve', 90, measure)).toEqual(['çokuzunbirsözcük', 've'])
  })
})
