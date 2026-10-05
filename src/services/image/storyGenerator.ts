import { getCategory } from '../../config/categories'
import { theme } from '../../config/theme'
import type { CategoryAnalysis } from '../analysis/types'
import {
  ellipsize,
  fitTeams,
  layoutRows,
  LIST_AREA,
  pickFontSize,
  STANDARD_ROW_HEIGHT,
  TALL_ROW_HEIGHT,
  STORY,
  type RowLayout,
} from './storyLayout'

export interface StoryRow {
  home: string
  away: string
  time?: string
  league?: string
  percent: number
  /** 1-5; güvenilirliğe göre üst sınır uygulanmış değer */
  stars: number
}

export interface StoryData {
  categoryLabel: string
  /** "5 Ekim 2026 Pazartesi" */
  dateLabel: string
  rows: StoryRow[]
}

export const STORY_NOTE = 'Veri destekli sinyal, garanti değil.'

// Projeye gömülü yazı tipi (index.css); yedekler yalnızca yüklenemezse devreye girer.
const FONT_FAMILY = '"Inter Variable"'
const FONT = `${FONT_FAMILY}, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`
const FONT_WEIGHTS = [500, 600, 700, 800, 900]

/**
 * Tuvale çizmeden önce gömülü yazı tipinin yüklenmesini bekler. Örnek metin,
 * Türkçe harflerin bulunduğu alt kümenin de indirilmesini sağlar.
 */
async function loadStoryFonts(): Promise<void> {
  const sample = 'AZaz09 ğĞıİşŞçÇöÖüÜ %–…·'
  await Promise.all(FONT_WEIGHTS.map((w) => document.fonts.load(`${w} 40px ${FONT_FAMILY}`, sample)))
}

/** Logonun, çevresindeki şeffaf boşluk dışında kalan kısmı (1024x1024 kaynak üzerinde) */
const LOGO_CROP = { x: 140, y: 36, size: 800 }

type Ctx = CanvasRenderingContext2D

/** Analiz sonucundan görsel verisi. Oranlar (odds) ve ham istatistikler görsele girmez. */
export const storyFromAnalysis = (analysis: CategoryAnalysis, dateLabel: string): StoryData => ({
  categoryLabel: getCategory(analysis.categoryId).label,
  dateLabel,
  rows: analysis.predictions.map((p) => ({
    home: p.match.home,
    away: p.match.away,
    time: p.match.time,
    league: p.match.league,
    percent: p.percent,
    stars: p.stars,
  })),
})

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawStar(ctx: Ctx, cx: number, cy: number, radius: number, color: string) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle))
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

/** Sağ kenarı rightX olan 5 yıldız çizer; yazı tipi yerine çizim olduğu için her cihazda aynı görünür. */
function drawStars(ctx: Ctx, rightX: number, cy: number, radius: number, count: number) {
  const step = radius * 2.3
  for (let i = 0; i < 5; i++) {
    drawStar(ctx, rightX - radius - (4 - i) * step, cy, radius, i < count ? theme.brand : theme.navy600)
  }
}

function drawBackground(ctx: Ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, STORY.height)
  gradient.addColorStop(0, theme.navy950)
  gradient.addColorStop(0.5, theme.navy900)
  gradient.addColorStop(1, theme.navy800)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, STORY.width, STORY.height)

  const glow = ctx.createRadialGradient(STORY.width, 0, 0, STORY.width, 0, 900)
  glow.addColorStop(0, 'rgba(251, 125, 39, 0.22)')
  glow.addColorStop(1, 'rgba(251, 125, 39, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, STORY.width, STORY.height)
}

/**
 * Logo şeffaf zeminlidir ve koyu lacivert konturu koyu arka planda kaybolur;
 * bu yüzden bir ton açık, çerçeveli bir rozetin içine yerleştirilir.
 */
function drawLogoBadge(ctx: Ctx, logo: CanvasImageSource | null, x: number, y: number, size: number) {
  roundRect(ctx, x, y, size, size, 44)
  ctx.fillStyle = theme.navy700
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = theme.brand
  ctx.stroke()
  const pad = 14
  if (logo) {
    ctx.drawImage(logo, LOGO_CROP.x, LOGO_CROP.y, LOGO_CROP.size, LOGO_CROP.size, x + pad, y + pad, size - 2 * pad, size - 2 * pad)
  } else {
    ctx.fillStyle = theme.white
    ctx.font = font(900, 34)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GOLLAZIM', x + size / 2, y + size / 2)
  }
}

function drawHeader(ctx: Ctx, data: StoryData, logo: CanvasImageSource | null) {
  const badge = { x: LIST_AREA.left, y: 240, size: 210 }
  drawLogoBadge(ctx, logo, badge.x, badge.y, badge.size)

  const textX = badge.x + badge.size + 36
  const textWidth = LIST_AREA.right - textX
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = theme.white
  ctx.font = font(800, 50)
  ctx.fillText('GÜNÜN', textX, 284)

  const fitSize = (text: string, sizes: number[]) =>
    pickFontSize(sizes, (s) => {
      ctx.font = font(900, s)
      return ctx.measureText(text).width <= textWidth
    })
  // Kategori adı uzunsa ("İLK YARI 0.5 ÜST", "KORNER 10.5 ÜST") küçülerek tek satıra sığar.
  const single = fitSize(data.categoryLabel, [88, 80, 72, 64, 56, 50, 44, 40, 36])
  const [first, second] = data.categoryLabel.split(' & ')
  ctx.fillStyle = theme.brand
  let footerY = 448
  if (single < 56 && second) {
    // Çok uzun adlar ("DEPLASMAN KAZANIR & 2.5 ÜST") küçücük kalmasın diye "&" işaretinden ikiye bölünür.
    const lines = [first, `& ${second}`]
    const size = Math.min(...lines.map((line) => fitSize(line, [54, 50, 46, 42])))
    ctx.font = font(900, size)
    ctx.fillText(lines[0], textX, 346)
    ctx.fillText(lines[1], textX, 402)
    footerY = 462
  } else {
    ctx.font = font(900, single)
    ctx.fillText(data.categoryLabel, textX, 382)
  }

  ctx.fillStyle = theme.white
  ctx.font = font(800, 50)
  ctx.fillText('ÖNERİLERİ', textX, footerY)

  ctx.fillStyle = theme.muted
  ctx.font = font(600, 34)
  ctx.fillText(data.dateLabel, LIST_AREA.left, 520)
}

function drawRow(ctx: Ctx, row: StoryRow, rank: number, top: number, layout: RowLayout) {
  const { left, right } = LIST_AREA
  const { rowHeight: h, roomy } = layout
  const mid = top + h / 2
  // Az maçlı görsellerde kart büyür; sıra numarası, yüzde ve yıldızlar da aynı oranda büyür.
  const k = roomy ? Math.max(1, h / STANDARD_ROW_HEIGHT) : 1
  const measure = (text: string) => ctx.measureText(text).width

  roundRect(ctx, left, top, right - left, h, roomy ? 26 * k : 18)
  ctx.fillStyle = theme.navy700
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.navy600
  ctx.stroke()

  // Sıra numarası
  const rankR = roomy ? 26 * k : 20
  const rankX = left + 22 + rankR
  ctx.beginPath()
  ctx.arc(rankX, mid, rankR, 0, Math.PI * 2)
  ctx.fillStyle = theme.navy600
  ctx.fill()
  ctx.fillStyle = theme.white
  ctx.font = font(800, roomy ? 28 * k : 22)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(rank), rankX, mid + 1)

  // Sağ blok: yüzde ve yıldızlar
  const percentText = `%${row.percent}`
  const rightX = right - 26
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.brand
  let textRight: number
  if (roomy) {
    ctx.font = font(900, 60 * k)
    ctx.fillText(percentText, rightX, mid - 16 * k)
    drawStars(ctx, rightX, mid + 34 * k, 13 * k, row.stars)
    textRight = rightX - Math.max(ctx.measureText('%100').width, 150 * k) - 24
  } else {
    ctx.font = font(900, 38)
    ctx.fillText(percentText, rightX, mid + 1)
    const percentWidth = ctx.measureText('%100').width
    drawStars(ctx, rightX - percentWidth - 18, mid, 10, row.stars)
    textRight = rightX - percentWidth - 18 - 5 * 23 - 20
  }

  // Sol blok: takımlar, saat, lig
  const textLeft = rankX + rankR + 20
  ctx.textAlign = 'left'
  const meta = [row.time, row.league].filter(Boolean).join('  ·  ')
  if (roomy && h >= TALL_ROW_HEIGHT) {
    // Az maçlı görsel: kart yüksek, her takım kendi satırında tam genişliği kullanır.
    const width = textRight - textLeft
    const size = pickFontSize([48, 44, 40, 36, 32], (s) => {
      ctx.font = font(800, s)
      return measure(row.home) <= width && measure(row.away) <= width
    })
    ctx.font = font(800, size)
    ctx.fillStyle = theme.white
    ctx.fillText(ellipsize(row.home, width, measure), textLeft, mid - 48)
    ctx.fillText(ellipsize(row.away, width, measure), textLeft, mid + 6)
    ctx.font = font(500, 26)
    ctx.fillStyle = theme.muted
    ctx.fillText(ellipsize(meta, width, measure), textLeft, mid + 58)
  } else if (roomy) {
    const width = textRight - textLeft
    const size = pickFontSize([40, 36, 32, 28], (s) => {
      ctx.font = font(800, s)
      return measure(`${row.home} – ${row.away}`) <= width
    })
    ctx.font = font(800, size)
    ctx.fillStyle = theme.white
    ctx.fillText(fitTeams(row.home, row.away, width, measure), textLeft, mid - 18)
    ctx.font = font(500, 26)
    ctx.fillStyle = theme.muted
    ctx.fillText(ellipsize(meta, width, measure), textLeft, mid + 30)
  } else {
    let x = textLeft
    if (row.time) {
      ctx.font = font(600, 24)
      ctx.fillStyle = theme.muted
      ctx.fillText(row.time, x, mid + 1)
      x += ctx.measureText('00:00').width + 16
    }
    const width = textRight - x
    const size = pickFontSize([30, 27, 24], (s) => {
      ctx.font = font(700, s)
      return measure(`${row.home} – ${row.away}`) <= width
    })
    ctx.font = font(700, size)
    ctx.fillStyle = theme.white
    ctx.fillText(fitTeams(row.home, row.away, width, measure), x, mid + 1)
  }
}

/** 1080x1920 tuvale story görselini çizer. */
export function drawStory(ctx: Ctx, data: StoryData, logo: CanvasImageSource | null): void {
  drawBackground(ctx)
  drawHeader(ctx, data, logo)

  const layout = layoutRows(data.rows.length)
  data.rows.forEach((row, i) => drawRow(ctx, row, i + 1, layout.top + i * (layout.rowHeight + layout.gap), layout))

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.muted
  ctx.font = font(500, 28)
  ctx.fillText(STORY_NOTE, STORY.width / 2, 1680)
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    // Logo yüklenemezse görsel yine üretilir; rozette yazı görünür.
    image.onerror = () => resolve(null)
    image.src = src
  })

/** Story görselini PNG olarak üretir. */
export async function createStoryPng(data: StoryData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = STORY.width
  canvas.height = STORY.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tarayıcı görsel oluşturmayı desteklemiyor.')
  const [logo] = await Promise.all([loadImage('./logo.png'), loadStoryFonts()])
  drawStory(ctx, data, logo)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Görsel oluşturulamadı.'))), 'image/png'),
  )
}
