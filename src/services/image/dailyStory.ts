import { getCategory } from '../../config/categories'
import { theme } from '../../config/theme'
import { wholePercent, type DailyRow, type DailySummary } from '../stats/dailySummary'
import type { Tally } from '../stats/statsEngine'
import { drawBackground, drawLogoBadge, font, renderStoryPng, roundRect, type Ctx } from './storyGenerator'
import { STORY } from './storyLayout'

/** Instagram arayüzünün kapattığı üst ve alt şeritlerin dışında kalan alan */
export const DAILY_SAFE_AREA = { top: 250, bottom: 1670 } as const

/** Günlük başarı görselinin dikey yerleşimi (piksel); metinlerde değer satır taban çizgisidir */
export const DAILY_LAYOUT = {
  left: 60,
  right: 1020,
  badge: { top: 262, size: 180 },
  dateBaseline: 520,
  rows: { top: 566, height: 132, gap: 14 },
  overall: { percentBaseline: 1490, countBaseline: 1576, captionBaseline: 1640 },
} as const

export const DAILY_OVERALL_CAPTION = 'Genel başarı'
const NO_DATA = '—'

const percentText = (t: Tally): string => {
  const percent = wholePercent(t)
  return percent === null ? NO_DATA : `%${percent}`
}

/** "4/6": kazanan / sonuçlanan */
const countText = (t: Tally): string => `${t.won}/${t.decided}`

function drawRow(ctx: Ctx, row: DailyRow, top: number) {
  const { left, right, rows } = DAILY_LAYOUT
  const pad = 30
  const percent = wholePercent(row.tally)

  roundRect(ctx, left, top, right - left, rows.height, 26)
  ctx.fillStyle = theme.navy700
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.navy600
  ctx.stroke()

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'right'
  const textY = top + 68
  if (percent === null) {
    ctx.fillStyle = theme.muted
    ctx.font = font(900, 66)
    ctx.fillText(NO_DATA, right - pad, textY)
  } else {
    ctx.fillStyle = theme.brand
    ctx.font = font(900, 66)
    ctx.fillText(percentText(row.tally), right - pad, textY)
    // Sayım, en geniş yüzdeye ("%100") göre hizalanır ki satırlar alt alta düzgün dursun.
    const countRight = right - pad - ctx.measureText('%100').width - 26
    ctx.fillStyle = theme.white
    ctx.font = font(700, 46)
    ctx.fillText(countText(row.tally), countRight, textY)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = theme.white
  ctx.font = font(800, 44)
  ctx.fillText(getCategory(row.categoryId).label, left + pad, textY - 4)

  const bar = { x: left + pad, y: top + 92, width: right - left - 2 * pad, height: 18 }
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

/** 1080x1920 tuvale günlük başarı görselini çizer: logo, tarih, 5 kategori, genel başarı. */
export function drawDailyStory(ctx: Ctx, summary: DailySummary, dateLabel: string, logo: CanvasImageSource | null): void {
  const { badge, rows, overall } = DAILY_LAYOUT
  const center = STORY.width / 2
  drawBackground(ctx)
  drawLogoBadge(ctx, logo, center - badge.size / 2, badge.top, badge.size)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.white
  ctx.font = font(700, 54)
  ctx.fillText(dateLabel, center, DAILY_LAYOUT.dateBaseline)

  summary.rows.forEach((row, i) => drawRow(ctx, row, rows.top + i * (rows.height + rows.gap)))

  const hasData = summary.overall.decided > 0
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = hasData ? theme.brand : theme.muted
  // Veri yokken çizgi, 200 px'lik rakamlar kadar ağır durmasın diye küçültülür.
  ctx.font = hasData ? font(900, 200) : font(800, 130)
  ctx.fillText(percentText(summary.overall), center, overall.percentBaseline)
  if (hasData) {
    ctx.fillStyle = theme.white
    ctx.font = font(800, 68)
    ctx.fillText(countText(summary.overall), center, overall.countBaseline)
  }
  ctx.fillStyle = theme.muted
  ctx.font = font(700, 46)
  ctx.fillText(DAILY_OVERALL_CAPTION, center, overall.captionBaseline)
}

export const dailyStoryFileName = (date: string): string => `gollazim-gunluk-${date}.png`

/** Günlük başarı görselini PNG olarak üretir. */
export const createDailyStoryPng = (summary: DailySummary, dateLabel: string): Promise<Blob> =>
  renderStoryPng((ctx, logo) => drawDailyStory(ctx, summary, dateLabel, logo))
