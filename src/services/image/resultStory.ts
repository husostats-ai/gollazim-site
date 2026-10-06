import { getCategory } from '../../config/categories'
import { CATEGORY_DESCRIPTIONS } from '../../config/categoryDescriptions'
import { DEFAULT_STORY_TEXTS, type StoryTexts } from '../../config/storyTexts'
import { theme } from '../../config/theme'
import { RESULT_LABELS, type CategoryResult, type CategoryResultRow, type ResultStatus } from '../stats/categoryResult'
import { wholePercent } from '../stats/dailySummary'
import type { Tally } from '../stats/statsEngine'
import { DAILY_TEXT } from './dailyStory'
import { drawFooter, footerHeight, layoutFooter } from './storyFooter'
import {
  drawBackground,
  drawCard,
  drawStoryHeader,
  drawTeams,
  fitTeamsOnCanvas,
  font,
  renderStoryPng,
  rowGeometry,
  STORY_NOTE,
  storyFooterStyle,
  type Ctx,
  type RowGeometry,
} from './storyGenerator'
import { asDense, FOOTER_GAP, HEADER, headerModeFor, planRows, SAFE_AREA, type RowPlan } from './storyLayout'

// Kategori sonuç görseli: bir günün tek kategorideki önerilerinin sonuçları.
// Paylaşılan kaydı oluşturmaz ve değiştirmez; yalnızca mevcut kayıtları gösterir.

export const RESULT_TEXT = { tail: 'SONUÇLARI', empty: 'Bu ölçüde öneri yok', noDecided: 'Sonuçlanmış öneri yok', hit: 'İSABET' } as const

/** "3/4 · %75"; sonuçlanmış öneri yoksa "—" */
export const resultSummaryText = (t: Tally): string => {
  const percent = wholePercent(t)
  return percent === null ? '—' : `${t.won}/${t.decided} · %${percent}`
}

const STATUS_COLOR: Record<ResultStatus, string> = { won: theme.win, lost: theme.loss, void: theme.navy600, pending: theme.navy600 }

/**
 * Sonuç işareti: tuttu ✓, tutmadı ✗, değerlendirilemedi —, bekliyor ··· .
 * Yazı tipi yerine çizimdir (her cihazda aynı görünür) ve renkten bağımsız okunur.
 */
function drawMark(ctx: Ctx, status: ResultStatus, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = STATUS_COLOR[status]
  ctx.fill()
  ctx.strokeStyle = theme.white
  ctx.lineWidth = Math.max(3, r * 0.2)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (status === 'won') {
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02)
    ctx.lineTo(cx - r * 0.12, cy + r * 0.36)
    ctx.lineTo(cx + r * 0.48, cy - r * 0.32)
  } else if (status === 'lost') {
    ctx.moveTo(cx - r * 0.36, cy - r * 0.36)
    ctx.lineTo(cx + r * 0.36, cy + r * 0.36)
    ctx.moveTo(cx + r * 0.36, cy - r * 0.36)
    ctx.lineTo(cx - r * 0.36, cy + r * 0.36)
  } else if (status === 'void') {
    ctx.moveTo(cx - r * 0.42, cy)
    ctx.lineTo(cx + r * 0.42, cy)
  } else {
    for (const dx of [-0.42, 0, 0.42]) {
      ctx.moveTo(cx + r * dx, cy)
      ctx.lineTo(cx + r * dx + 0.01, cy)
    }
  }
  ctx.stroke()
}

const statusText = (row: CategoryResultRow): string => [RESULT_LABELS[row.status], row.detail].filter(Boolean).join('  ·  ')
const scoreText = (row: CategoryResultRow): string => row.score ?? '—'

function drawSummary(ctx: Ctx, result: CategoryResult, top: number, height: number) {
  const { left, right } = SAFE_AREA
  drawCard(ctx, top, height, 28)
  const decided = result.tally.decided > 0
  const mid = top + height / 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = decided ? theme.brand : theme.muted
  ctx.font = font(900, Math.round(height * 0.5))
  const summary = resultSummaryText(result.tally)
  ctx.fillText(summary, left + 34, mid + 2)
  const summaryRight = left + 34 + ctx.measureText(summary).width
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.muted
  const label = decided ? RESULT_TEXT.hit : RESULT_TEXT.noDecided
  ctx.font = font(700, Math.round(height * 0.26))
  // Etiket özetle çakışacaksa yazılmaz (çok dar durumlar).
  if (right - 34 - ctx.measureText(label).width > summaryRight + 24) ctx.fillText(label, right - 34, mid + 2)
}

function drawResultRow(ctx: Ctx, row: CategoryResultRow, top: number, plan: RowPlan, geometry: RowGeometry, team: { size: number; split: boolean }) {
  const h = plan.rowHeight
  const mid = top + h / 2
  const full = plan.mode === 'full'
  drawCard(ctx, top, h, full ? Math.min(32, Math.round(h * 0.17)) : 16)
  drawMark(ctx, row.status, geometry.markX, mid, geometry.markR)

  // Sağ blok: maç sonucu
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = row.score ? theme.white : theme.muted
  ctx.font = font(900, scoreSize(plan))
  ctx.fillText(scoreText(row), geometry.rightX, mid + 2)
  if (!full) {
    // Sıkışık düzende alt satır yoktur: yarı skoru / korner sayısı ya da durum, skorun solunda yazar.
    const note = denseNote(row)
    if (note) {
      const scoreWidth = Math.max(ctx.measureText('0-0').width, ctx.measureText(scoreText(row)).width)
      ctx.font = font(600, plan.metaSize)
      ctx.fillStyle = theme.muted
      ctx.fillText(note, geometry.rightX - scoreWidth - DENSE_NOTE_GAP, mid + 1)
    }
  }

  const width = geometry.textRight - geometry.textLeft
  const metaMid = drawTeams(ctx, row, team.split, team.size, plan, geometry.textLeft, width, mid)
  if (full) {
    ctx.font = font(700, plan.metaSize)
    ctx.fillStyle = row.status === 'won' ? theme.win : row.status === 'lost' ? theme.loss : theme.muted
    ctx.fillText(statusText(row), geometry.textLeft, metaMid)
  }
}

const scoreSize = (plan: RowPlan): number => Math.round(plan.percentSize * (plan.mode === 'full' ? 0.78 : 0.86))

const DENSE_NOTE_GAP = 16
/** Sıkışık düzende skorun solundaki kısa not: "2Y 1-0", "Korner 11"; sonucu olmayan maçta durum */
const denseNote = (row: CategoryResultRow): string => (row.status === 'void' || row.status === 'pending' ? RESULT_LABELS[row.status] : row.detail)

/** Sağ bloğun en geniş hâli: skor ve (sıkışık düzende) solundaki not */
function scoreBlockWidth(ctx: Ctx, plan: RowPlan, rows: CategoryResultRow[]): number {
  ctx.font = font(900, scoreSize(plan))
  const score = Math.max(ctx.measureText('0-0').width, ...rows.map((r) => ctx.measureText(scoreText(r)).width))
  if (plan.mode === 'full') return score
  ctx.font = font(600, plan.metaSize)
  const note = Math.max(0, ...rows.map((r) => ctx.measureText(denseNote(r)).width))
  return note > 0 ? score + DENSE_NOTE_GAP + note : score
}

/** 1080x1920 tuvale kategori sonuç görselini çizer. */
export function drawResultStory(
  ctx: Ctx,
  result: CategoryResult,
  dateLabel: string,
  logo: CanvasImageSource | null,
  texts: StoryTexts = DEFAULT_STORY_TEXTS,
): void {
  drawBackground(ctx)
  const count = result.rows.length
  const mode = headerModeFor(count)
  drawStoryHeader(ctx, logo, mode, {
    lead: dateLabel.toLocaleUpperCase('tr'),
    title: getCategory(result.categoryId).label,
    tail: RESULT_TEXT.tail,
    sub: [
      { text: CATEGORY_DESCRIPTIONS[result.categoryId], color: theme.white, weight: 600 },
      { text: `${DAILY_TEXT.subtitle[result.scope]}  •  ${count} maç`, color: theme.muted, weight: 600 },
    ],
  })

  const summaryHeight = mode === 'large' ? 120 : 92
  const summaryTop = HEADER[mode].bottom
  drawSummary(ctx, result, summaryTop, summaryHeight)

  const footerStyle = storyFooterStyle(count)
  const footer = layoutFooter(ctx, { ...texts, disclaimer: texts.disclaimer.trim() || STORY_NOTE }, footerStyle)
  const footerTop = SAFE_AREA.bottom - footerHeight(footer)
  const rowsTop = summaryTop + summaryHeight + 18

  if (count === 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = theme.muted
    ctx.font = font(600, 40)
    ctx.fillText(RESULT_TEXT.empty, (SAFE_AREA.left + SAFE_AREA.right) / 2, (rowsTop + footerTop) / 2)
  } else {
    const layout = (plan: RowPlan) => {
      const geometry = rowGeometry(plan, scoreBlockWidth(ctx, plan, result.rows))
      return { plan, geometry, team: fitTeamsOnCanvas(ctx, plan, result.rows, geometry.textRight - geometry.textLeft) }
    }
    let fitted = layout(planRows(count, rowsTop, footerTop - FOOTER_GAP))
    // Uzun adlar geniş düzene sığmıyorsa adları kesmek yerine sıkışık düzene geçilir.
    if (fitted.team.overflow && fitted.plan.mode === 'full' && fitted.plan.rowHeight < 150) fitted = layout(asDense(fitted.plan))
    const { plan, geometry, team } = fitted
    result.rows.forEach((row, i) =>
      drawResultRow(ctx, row, plan.top + i * (plan.rowHeight + plan.gap), plan, geometry, { size: team.size, split: team.split[i] }),
    )
  }

  drawFooter(ctx, footer, footerTop, footerStyle)
}

export const resultStoryFileName = (slug: string, date: string): string => `gollazim-sonuc-${slug}-${date}.png`

/** Kategori sonuç görselini PNG olarak üretir. */
export const createResultStoryPng = (result: CategoryResult, dateLabel: string, texts?: StoryTexts): Promise<Blob> =>
  renderStoryPng((ctx, logo) => drawResultStory(ctx, result, dateLabel, logo, texts))
