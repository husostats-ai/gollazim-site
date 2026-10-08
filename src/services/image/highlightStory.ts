import { DEFAULT_STORY_TEXTS, type StoryTexts } from '../../config/storyTexts'
import { theme } from '../../config/theme'
import type { PickOutcome } from '../../types'
import { HIGHLIGHT_OUTCOME_LABELS, type HighlightSummary } from '../highlights/highlights'
import { drawMark } from './resultStory'
import { drawFooter, footerHeight, layoutFooter } from './storyFooter'
import {
  drawBackground,
  drawCard,
  drawRank,
  drawStoryHeader,
  drawTeams,
  fitTeamsOnCanvas,
  font,
  renderStoryPng,
  rowGeometry,
  storyFooterStyle,
  STORY_TIMEZONE_NOTE,
  type Ctx,
  type RowGeometry,
} from './storyGenerator'
import { asDense, FOOTER_GAP, HEADER, headerModeFor, pickFontSize, planRows, SAFE_AREA, type RowPlan } from './storyLayout'

// "Günün öne çıkanları" görselleri: seçim listesi ve sonuçları. Mevcut Story altyapısının
// parçalarıyla çizilir (arka plan, başlık, kart, takım sığdırma, alt blok, sonuç işareti).
// Yüzde, yıldız ve güvenilirlik YAZILMAZ. Paylaşılan kaydı oluşturmaz ve değiştirmez.

/** Bir görseldeki en fazla satır; fazlası sonraki görsele geçer ("1/2", "2/2") */
export const HIGHLIGHT_STORY_PAGE_SIZE = 15

/** Alt bloktaki not sabittir; düzenlenebilir uyarı metnine bağlı değildir */
export const HIGHLIGHT_STORY_NOTE = 'İstatistik taramasıdır, bahis tavsiyesi değildir.'

export const HIGHLIGHT_STORY_TEXT = {
  list: { title: 'ÖNE ÇIKANLAR', tail: 'GÜNÜN SEÇİMLERİ' },
  results: { title: 'ÖNE ÇIKANLAR', tail: 'SONUÇLARI' },
  empty: 'Bu gün için seçim yok',
  noScore: '—',
} as const

export type HighlightStoryKind = 'list' | 'results'

export interface HighlightStoryRow {
  home: string
  away: string
  /** HH:mm */
  time: string
  categoryLabel: string
  /** "İY 1-0 · MS 3-1"; skor girilmediyse null */
  score: string | null
  outcome: PickOutcome
}

export interface HighlightStoryData {
  kind: HighlightStoryKind
  dateLabel: string
  /** Bu görseldeki satırlar (en fazla HIGHLIGHT_STORY_PAGE_SIZE) */
  rows: HighlightStoryRow[]
  /** Günün tüm seçimlerinin sayısı ve özeti (bölünmüş görsellerde hepsinde aynıdır) */
  total: number
  summary: HighlightSummary
  /** Görsel birden çok parçaya bölündüyse: 1'den başlar */
  page: number
  pages: number
  /** Bu görseldeki ilk satırın sıra numarası (1'den başlar) */
  firstRank: number
}

/** Günün seçimlerini görsellere böler; seçim yoksa tek, boş bir görsel verisi döner */
export function highlightStoryPages(kind: HighlightStoryKind, dateLabel: string, rows: HighlightStoryRow[], summary: HighlightSummary, pageSize: number = HIGHLIGHT_STORY_PAGE_SIZE): HighlightStoryData[] {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  return Array.from({ length: pages }, (_, i) => ({ kind, dateLabel, rows: rows.slice(i * pageSize, (i + 1) * pageSize), total: rows.length, summary, page: i + 1, pages, firstRank: i * pageSize + 1 }))
}

/** "Seçilen 6 · Tutan 3 · Tutmayan 1 · Bekleyen 2"; değerlendirilemeyen varsa sona eklenir */
export const highlightSummaryText = (s: HighlightSummary): string =>
  [`Seçilen ${s.selected}`, `Tutan ${s.won}`, `Tutmayan ${s.lost}`, `Bekleyen ${s.pending}`, ...(s.void > 0 ? [`Değerlendirilemeyen ${s.void}`] : [])].join('  ·  ')

/** Başlığın altındaki ikinci satır: "6 seçim • Saatler TSİ • 1/2" */
const countLine = (data: HighlightStoryData): string => [`${data.total} seçim`, STORY_TIMEZONE_NOTE, ...(data.pages > 1 ? [`${data.page}/${data.pages}`] : [])].join('  •  ')

/** Sağ blokta yazan skor; skor yoksa "—" */
const scoreText = (row: HighlightStoryRow): string => {
  if (!row.score) return HIGHLIGHT_STORY_TEXT.noScore
  const parts = row.score.split(' · ')
  const full = parts.find((part) => part.startsWith('MS '))
  // Maç sonucu varsa yalnızca skor ("3-1"); yalnızca ilk yarı girilmişse etiketiyle ("İY 1-0").
  return full ? full.slice(3) : parts[0]
}

/** Sağ blok: listede saat, sonuçlarda maç sonucu */
const rightText = (kind: HighlightStoryKind, row: HighlightStoryRow): string => (kind === 'list' ? row.time : scoreText(row))

/** Geniş düzende adların altındaki satır */
const metaText = (kind: HighlightStoryKind, row: HighlightStoryRow): string => (kind === 'list' ? row.categoryLabel : `${row.categoryLabel}  ·  ${HIGHLIGHT_OUTCOME_LABELS[row.outcome]}`)

/** Sıkışık düzende sağ bloğun solundaki kısa not: kategori; sonucu olmayan seçimde durumuyla */
const denseNote = (kind: HighlightStoryKind, row: HighlightStoryRow): string =>
  kind === 'results' && (row.outcome === 'pending' || row.outcome === 'void') ? `${row.categoryLabel} · ${HIGHLIGHT_OUTCOME_LABELS[row.outcome]}` : row.categoryLabel

const DENSE_NOTE_GAP = 16
const rightSize = (plan: RowPlan): number => Math.round(plan.percentSize * (plan.mode === 'full' ? 0.78 : 0.86))

function rightBlockWidth(ctx: Ctx, plan: RowPlan, data: HighlightStoryData): number {
  ctx.font = font(900, rightSize(plan))
  const main = Math.max(ctx.measureText('00:00').width, ...data.rows.map((r) => ctx.measureText(rightText(data.kind, r)).width))
  if (plan.mode === 'full') return main
  ctx.font = font(600, plan.metaSize)
  return main + DENSE_NOTE_GAP + Math.max(0, ...data.rows.map((r) => ctx.measureText(denseNote(data.kind, r)).width))
}

const outcomeColor = (outcome: PickOutcome): string => (outcome === 'won' ? theme.win : outcome === 'lost' ? theme.loss : theme.muted)

function drawRow(ctx: Ctx, data: HighlightStoryData, row: HighlightStoryRow, rank: number, top: number, plan: RowPlan, geometry: RowGeometry, team: { size: number; split: boolean }) {
  const h = plan.rowHeight
  const mid = top + h / 2
  const full = plan.mode === 'full'
  drawCard(ctx, top, h, full ? Math.min(32, Math.round(h * 0.17)) : 16)
  if (data.kind === 'results') drawMark(ctx, row.outcome, geometry.markX, mid, geometry.markR)
  else drawRank(ctx, rank, geometry, mid)

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = data.kind === 'results' && !row.score ? theme.muted : theme.white
  ctx.font = font(900, rightSize(plan))
  const main = rightText(data.kind, row)
  ctx.fillText(main, geometry.rightX, mid + 2)
  if (!full) {
    const mainWidth = Math.max(ctx.measureText('00:00').width, ctx.measureText(main).width)
    ctx.font = font(600, plan.metaSize)
    ctx.fillStyle = data.kind === 'results' ? outcomeColor(row.outcome) : theme.brand
    ctx.fillText(denseNote(data.kind, row), geometry.rightX - mainWidth - DENSE_NOTE_GAP, mid + 1)
  }

  const width = geometry.textRight - geometry.textLeft
  const metaMid = drawTeams(ctx, row, team.split, team.size, plan, geometry.textLeft, width, mid)
  if (full) {
    ctx.font = font(700, plan.metaSize)
    ctx.fillStyle = data.kind === 'results' ? outcomeColor(row.outcome) : theme.brand
    ctx.fillText(metaText(data.kind, row), geometry.textLeft, metaMid)
  }
}

/** Sonuç görselinin özet kartı: tek satır, karta sığacak boyutta */
function drawSummary(ctx: Ctx, summary: HighlightSummary, top: number, height: number) {
  const { left, right } = SAFE_AREA
  drawCard(ctx, top, height, 28)
  const text = highlightSummaryText(summary)
  const size = pickFontSize([44, 40, 36, 32, 28, 26, 24, 22], (s) => {
    ctx.font = font(800, s)
    return ctx.measureText(text).width <= right - left - 60
  })
  ctx.font = font(800, size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme.white
  ctx.fillText(text, (left + right) / 2, top + height / 2 + 2)
}

/** 1080x1920 tuvale "öne çıkanlar" görselini (liste ya da sonuçlar) çizer. */
export function drawHighlightStory(ctx: Ctx, data: HighlightStoryData, logo: CanvasImageSource | null, texts: StoryTexts = DEFAULT_STORY_TEXTS): void {
  drawBackground(ctx)
  const count = data.rows.length
  const mode = headerModeFor(count)
  drawStoryHeader(ctx, logo, mode, {
    lead: data.dateLabel.toLocaleUpperCase('tr'),
    title: HIGHLIGHT_STORY_TEXT[data.kind].title,
    tail: HIGHLIGHT_STORY_TEXT[data.kind].tail,
    sub: [{ text: countLine(data), color: theme.white, weight: 600 }],
  })

  let rowsTop: number = HEADER[mode].bottom
  if (data.kind === 'results') {
    const summaryHeight = mode === 'large' ? 120 : 92
    drawSummary(ctx, data.summary, rowsTop, summaryHeight)
    rowsTop += summaryHeight + 18
  }

  const footerStyle = storyFooterStyle(count)
  // Alt bloktaki uyarı düzenlenebilir metin değil, sabit nottur.
  const footer = layoutFooter(ctx, { ...texts, disclaimer: HIGHLIGHT_STORY_NOTE }, footerStyle)
  const footerTop = SAFE_AREA.bottom - footerHeight(footer)

  if (count === 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = theme.muted
    ctx.font = font(600, 40)
    ctx.fillText(HIGHLIGHT_STORY_TEXT.empty, (SAFE_AREA.left + SAFE_AREA.right) / 2, (rowsTop + footerTop) / 2)
  } else {
    const layout = (plan: RowPlan) => {
      const geometry = rowGeometry(plan, rightBlockWidth(ctx, plan, data))
      return { plan, geometry, team: fitTeamsOnCanvas(ctx, plan, data.rows, geometry.textRight - geometry.textLeft) }
    }
    let fitted = layout(planRows(count, rowsTop, footerTop - FOOTER_GAP))
    // Uzun adlar geniş düzene sığmıyorsa adları kesmek yerine sıkışık düzene geçilir.
    if (fitted.team.overflow && fitted.plan.mode === 'full' && fitted.plan.rowHeight < 150) fitted = layout(asDense(fitted.plan))
    const { plan, geometry, team } = fitted
    data.rows.forEach((row, i) => drawRow(ctx, data, row, data.firstRank + i, plan.top + i * (plan.rowHeight + plan.gap), plan, geometry, { size: team.size, split: team.split[i] }))
  }

  drawFooter(ctx, footer, footerTop, footerStyle)
}

/** "gollazim-one-cikanlar-2026-10-08.png"; sonuç görseli "-sonuc", bölünmüş görsel "-2" ekiyle */
export const highlightStoryFileName = (data: Pick<HighlightStoryData, 'kind' | 'page' | 'pages'>, date: string): string =>
  `gollazim-one-cikanlar${data.kind === 'results' ? '-sonuc' : ''}-${date}${data.pages > 1 ? `-${data.page}` : ''}.png`

export const createHighlightStoryPng = (data: HighlightStoryData, texts?: StoryTexts): Promise<Blob> => renderStoryPng((ctx, logo) => drawHighlightStory(ctx, data, logo, texts))
