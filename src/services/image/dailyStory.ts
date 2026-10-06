import { getCategory } from '../../config/categories'
import { DEFAULT_STORY_TEXTS, type StoryTexts } from '../../config/storyTexts'
import { theme } from '../../config/theme'
import { wholePercent, type DailyRow, type DailySummary } from '../stats/dailySummary'
import type { Tally } from '../stats/statsEngine'
import type { StatsScope } from '../story/shared'
import { drawBackground, drawLogoBadge, font, renderStoryPng, roundRect, type Ctx } from './storyGenerator'
import { drawFooter, footerHeight, layoutFooter, type FooterStyle } from './storyFooter'
import { ellipsize, pickFontSize } from './storyLayout'

/** Instagram arayüzünün kapattığı üst ve alt şeritlerin dışında kalan alan */
export const DAILY_SAFE_AREA = { top: 250, bottom: 1670 } as const

/** Günlük başarı görselinin sabit ölçüleri (piksel); metinlerde değer satır taban çizgisidir */
export const DAILY_LAYOUT = {
  left: 60,
  right: 1020,
  badge: { top: 260, size: 176 },
  header: { brandBaseline: 314, dateBaseline: 372, subtitleBaseline: 420 },
  title: { baseline: 512, ruleTop: 532, ruleWidth: 120, ruleHeight: 8 },
  overall: { top: 566, height: 176 },
  rows: { gap: 16, standardHeight: 116, minHeight: 100, maxHeight: 150 },
  /** Kartlar ile alt blok arasında bırakılan en az boşluk */
  footerGap: 26,
} as const

export const DAILY_TEXT = {
  brand: 'GOL LAZIM ANALİZ',
  results: 'Sonuçlar',
  subtitle: { shared: 'Paylaşılan önerilerin sonuçları', all: 'Tüm önerilerin sonuçları' },
  title: 'GÜNÜN ANALİZ SONUÇLARI',
  overall: 'GENEL İSABET',
  noDecided: 'Sonuçlanmış öneri yok',
  note: 'Her öneri kendi kategorisinde ayrı sayılmıştır; aynı maç birden fazla listede yer alabilir.',
  telegram: 'Telegram:',
  instagram: 'Instagram:',
} as const

const NO_DATA = '—'

const percentText = (t: Tally): string => {
  const percent = wholePercent(t)
  return percent === null ? NO_DATA : `%${percent}`
}

/** "4/6": kazanan / sonuçlanan */
const countText = (t: Tally): string => `${t.won}/${t.decided}`

/** "15 önerinin 8 tanesi tuttu": sonuçlanan önerilerden kazananlar */
export const overallSentence = (t: Tally): string =>
  t.decided === 0 ? DAILY_TEXT.noDecided : `${t.decided} önerinin ${t.won} tanesi tuttu`

function drawHeader(ctx: Ctx, dateLabel: string, logo: CanvasImageSource | null, scope: StatsScope) {
  const { left, right, badge, header, title } = DAILY_LAYOUT
  drawLogoBadge(ctx, logo, left, badge.top, badge.size)

  const textX = left + badge.size + 34
  const measure = (text: string) => ctx.measureText(text).width
  const fit = (text: string, weight: number, sizes: number[], width: number) => {
    const size = pickFontSize(sizes, (s) => {
      ctx.font = font(weight, s)
      return measure(text) <= width
    })
    ctx.font = font(weight, size)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = theme.brand
  fit(DAILY_TEXT.brand, 900, [54, 50, 46], right - textX)
  ctx.fillText(DAILY_TEXT.brand, textX, header.brandBaseline)

  ctx.fillStyle = theme.muted
  const dateLine = `${dateLabel}  •  ${DAILY_TEXT.results}`
  fit(dateLine, 600, [42, 38, 34], right - textX)
  ctx.fillText(dateLine, textX, header.dateBaseline)
  const subtitle = DAILY_TEXT.subtitle[scope]
  fit(subtitle, 500, [34, 32, 30, 28], right - textX)
  ctx.fillText(subtitle, textX, header.subtitleBaseline)

  ctx.fillStyle = theme.white
  fit(DAILY_TEXT.title, 900, [76, 72, 68, 64, 60, 56], right - left)
  ctx.fillText(DAILY_TEXT.title, left, title.baseline)
  roundRect(ctx, left, title.ruleTop, title.ruleWidth, title.ruleHeight, title.ruleHeight / 2)
  ctx.fillStyle = theme.brand
  ctx.fill()
}

function drawCard(ctx: Ctx, top: number, height: number, radius: number) {
  const { left, right } = DAILY_LAYOUT
  roundRect(ctx, left, top, right - left, height, radius)
  ctx.fillStyle = theme.navy700
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.navy600
  ctx.stroke()
}

function drawOverall(ctx: Ctx, overall: Tally) {
  const { left, right } = DAILY_LAYOUT
  const { top, height } = DAILY_LAYOUT.overall
  const pad = 40
  const hasData = overall.decided > 0
  drawCard(ctx, top, height, 34)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = hasData ? theme.brand : theme.muted
  // Veri yokken çizgi, rakamlar kadar ağır durmasın diye küçültülür.
  ctx.font = hasData ? font(900, 124) : font(800, 84)
  const percent = percentText(overall)
  ctx.fillText(percent, left + pad, top + height / 2 + 44)

  // Sağdaki metin yüzdenin bittiği yerden başlar; "%100" gibi geniş değerlerde küçülür.
  const textX = left + pad + ctx.measureText(percent).width + 40
  const width = right - pad - textX
  ctx.fillStyle = theme.muted
  ctx.font = font(700, 32)
  ctx.fillText(DAILY_TEXT.overall, textX, top + height / 2 - 18)

  const sentence = overallSentence(overall)
  const size = pickFontSize([46, 44, 42, 40, 38, 36, 34, 32, 30, 28], (s) => {
    ctx.font = font(800, s)
    return ctx.measureText(sentence).width <= width
  })
  ctx.font = font(800, size)
  ctx.fillStyle = theme.white
  ctx.fillText(sentence, textX, top + height / 2 + 40)
}

function drawRow(ctx: Ctx, row: DailyRow, top: number, height: number) {
  const { left, right, rows } = DAILY_LAYOUT
  // Alt blok kısaldığında kartlar büyür; yazılar ve çubuk da aynı oranda büyür.
  const k = Math.max(1, height / rows.standardHeight)
  const pad = 30
  const percent = wholePercent(row.tally)
  drawCard(ctx, top, height, 26 * k)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  // Kart standarttan kısaysa yazı da yukarı kayar ki çubuğa değmesin.
  const textY = top + 60 * k - Math.max(0, rows.standardHeight - height) / 2
  ctx.font = font(900, 66 * k)
  let textRight: number
  if (percent === null) {
    ctx.fillStyle = theme.muted
    ctx.fillText(NO_DATA, right - pad, textY)
    textRight = right - pad - ctx.measureText(NO_DATA).width
  } else {
    ctx.fillStyle = theme.brand
    ctx.fillText(percentText(row.tally), right - pad, textY)
    // Sayım, en geniş yüzdeye ("%100") göre hizalanır ki satırlar alt alta düzgün dursun.
    const countRight = right - pad - ctx.measureText('%100').width - 26
    ctx.fillStyle = theme.muted
    ctx.font = font(700, 42 * k)
    const count = countText(row.tally)
    ctx.fillText(count, countRight, textY)
    textRight = countRight - ctx.measureText(count).width
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = theme.white
  const label = getCategory(row.categoryId).label
  const labelWidth = textRight - 36 - (left + pad)
  const measure = (text: string) => ctx.measureText(text).width
  // Büyüyen kartta uzun ad sayıma yaklaşmasın diye gerekirse standart boyuta iner.
  const labelSize = pickFontSize([46 * k, 46 * ((k + 1) / 2), 46, 44], (size) => {
    ctx.font = font(800, size)
    return measure(label) <= labelWidth
  })
  ctx.font = font(800, labelSize)
  ctx.fillText(ellipsize(label, labelWidth, measure), left + pad, textY - 4 * k)

  // Çubuk kartın altına yaslanır; alt blok çok uzarsa kart kısalır ama çubuk kartın içinde kalır.
  const bar = { x: left + pad, y: top + height - 34 * k, width: right - left - 2 * pad, height: 16 * k }
  roundRect(ctx, bar.x, bar.y, bar.width, bar.height, bar.height / 2)
  ctx.fillStyle = theme.navy600
  ctx.fill()
  if (percent !== null && percent > 0) {
    // Çok küçük oranlarda da yuvarlak uçlu bir dolgu görünsün.
    const filled = Math.max(bar.height, (bar.width * row.tally.won) / row.tally.decided)
    roundRect(ctx, bar.x, bar.y, filled, bar.height, bar.height / 2)
    ctx.fillStyle = theme.brand
    ctx.fill()
  }
}

const FOOTER_STYLE: FooterStyle = {
  left: DAILY_LAYOUT.left,
  right: DAILY_LAYOUT.right,
  note: DAILY_TEXT.note,
  linkSizes: [38, 36, 34, 32, 30, 28, 26],
  linkLineHeight: 52,
  disclaimerSizes: [26, 24, 22],
}

/**
 * 1080x1920 tuvale günlük başarı görselini çizer: üst blok, başlık, genel
 * isabet kartı, 5 kategori kartı ve alt blok. Alt blok güvenli alanın alt
 * sınırına yaslanır; kategori kartları aradaki boşluğu doldurur.
 */
export function drawDailyStory(
  ctx: Ctx,
  summary: DailySummary,
  dateLabel: string,
  logo: CanvasImageSource | null,
  texts: StoryTexts = DEFAULT_STORY_TEXTS,
  /** Özetin hangi öneriler üzerinden hesaplandığı; görselin alt başlığında yazar */
  scope: StatsScope = 'all',
): void {
  const { overall, rows, footerGap } = DAILY_LAYOUT
  drawBackground(ctx)
  drawHeader(ctx, dateLabel, logo, scope)
  drawOverall(ctx, summary.overall)

  const footer = layoutFooter(ctx, texts, FOOTER_STYLE)
  const footerTop = DAILY_SAFE_AREA.bottom - footerHeight(footer)

  const rowsTop = overall.top + overall.height + rows.gap
  const count = summary.rows.length
  const available = footerTop - footerGap - rowsTop
  const rowHeight = Math.max(rows.minHeight, Math.min(rows.maxHeight, Math.floor((available - rows.gap * (count - 1)) / count)))
  summary.rows.forEach((row, i) => drawRow(ctx, row, rowsTop + i * (rowHeight + rows.gap), rowHeight))

  drawFooter(ctx, footer, footerTop, FOOTER_STYLE)
}

export const dailyStoryFileName = (date: string): string => `gollazim-gunluk-${date}.png`

/** Günlük başarı görselini PNG olarak üretir. */
export const createDailyStoryPng = (
  summary: DailySummary,
  dateLabel: string,
  texts?: StoryTexts,
  scope?: StatsScope,
): Promise<Blob> => renderStoryPng((ctx, logo) => drawDailyStory(ctx, summary, dateLabel, logo, texts, scope))
