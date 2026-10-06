import { getCategory } from '../../config/categories'
import { CATEGORY_DESCRIPTIONS } from '../../config/categoryDescriptions'
import { fitLeague } from '../../config/leagueAbbreviations'
import { DEFAULT_STORY_TEXTS, type StoryTexts } from '../../config/storyTexts'
import { theme } from '../../config/theme'
import type { CategoryAnalysis } from '../analysis/types'
import { drawFooter, footerHeight, layoutFooter, type FooterStyle } from './storyFooter'
import {
  asDense,
  ellipsize,
  fitTeamNames,
  fitTeams,
  FOOTER_GAP,
  HEADER,
  headerModeFor,
  LEADING,
  pickFontSize,
  planRows,
  SAFE_AREA,
  STORY,
  type HeaderMode,
  type RowPlan,
  type TeamFit,
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
  /** Kategorinin kısa tanımı: "Maçta 3 veya daha fazla gol" */
  description: string
  /** "5 Ekim 2026 Pazartesi" */
  dateLabel: string
  rows: StoryRow[]
}

export const STORY_NOTE = 'Veri destekli sinyal, garanti değil.'

// Projeye gömülü yazı tipi (index.css); yedekler yalnızca yüklenemezse devreye girer.
const FONT_FAMILY = '"Inter Variable"'
const FONT = `${FONT_FAMILY}, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
export const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`
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

export type Ctx = CanvasRenderingContext2D

/** Analiz sonucundan görsel verisi. Oranlar (odds) ve ham istatistikler görsele girmez. */
export const storyFromAnalysis = (analysis: CategoryAnalysis, dateLabel: string): StoryData => ({
  categoryLabel: getCategory(analysis.categoryId).label,
  description: CATEGORY_DESCRIPTIONS[analysis.categoryId],
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

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
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

export function drawBackground(ctx: Ctx) {
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
export function drawLogoBadge(ctx: Ctx, logo: CanvasImageSource | null, x: number, y: number, size: number) {
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
    // Küçük rozette (çok maçlı görsel) yedek yazı da küçülür.
    ctx.font = font(900, size >= 170 ? 34 : Math.round(size * 0.19))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GOLLAZIM', x + size / 2, y + size / 2)
  }
}

export interface HeaderLine {
  text: string
  color: string
  weight: number
}

export interface HeaderContent {
  /** Başlığın üstündeki küçük satır ("GÜNÜN") */
  lead: string
  /** Turuncu, büyük satır (kategori adı) */
  title: string
  /** Başlığın altındaki küçük satır ("ÖNERİLERİ") */
  tail: string
  /** Rozetin altında, tam genişlikte en fazla iki satır */
  sub: HeaderLine[]
}

/** Logo rozeti, sağında üç satırlık başlık ve altında açıklama satırları. */
export function drawStoryHeader(ctx: Ctx, logo: CanvasImageSource | null, mode: HeaderMode, content: HeaderContent) {
  const spec = HEADER[mode]
  const { left, right } = SAFE_AREA
  drawLogoBadge(ctx, logo, left, spec.badge.top, spec.badge.size)

  const textX = left + spec.badge.size + spec.textGap
  const textWidth = right - textX
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const fitSize = (text: string, weight: number, sizes: readonly number[], width: number) =>
    pickFontSize([...sizes], (s) => {
      ctx.font = font(weight, s)
      return ctx.measureText(text).width <= width
    })

  ctx.fillStyle = theme.white
  ctx.font = font(800, spec.lead.size)
  ctx.fillText(content.lead, textX, spec.lead.baseline)

  // Kategori adı uzunsa ("İLK YARI 0.5 ÜST", "KORNER 10.5 ÜST") küçülerek tek satıra sığar.
  const single = fitSize(content.title, 900, spec.title.sizes, textWidth)
  const [first, second] = content.title.split(' & ')
  ctx.fillStyle = theme.brand
  let tailBaseline: number = spec.tail.baseline
  if (single < spec.splitBelow && second) {
    // Çok uzun adlar ("DEPLASMAN KAZANIR & 2.5 ÜST") küçücük kalmasın diye "&" işaretinden ikiye bölünür.
    const lines = [first, `& ${second}`]
    const size = Math.min(...lines.map((line) => fitSize(line, 900, spec.split.sizes, textWidth)))
    ctx.font = font(900, size)
    ctx.fillText(lines[0], textX, spec.split.baselines[0])
    ctx.fillText(lines[1], textX, spec.split.baselines[1])
    tailBaseline = spec.split.tailBaseline
  } else {
    ctx.font = font(900, single)
    ctx.fillText(content.title, textX, spec.title.baseline)
  }

  ctx.fillStyle = theme.white
  ctx.font = font(800, spec.tail.size)
  ctx.fillText(content.tail, textX, tailBaseline)

  const measure = (text: string) => ctx.measureText(text).width
  content.sub.slice(0, spec.sub.length).forEach((line, i) => {
    const size = fitSize(line.text, line.weight, spec.sub[i].sizes, right - left)
    ctx.font = font(line.weight, size)
    ctx.fillStyle = line.color
    ctx.fillText(ellipsize(line.text, right - left, measure), left, spec.sub[i].baseline)
  })
}

export function drawCard(ctx: Ctx, top: number, height: number, radius: number) {
  const { left, right } = SAFE_AREA
  roundRect(ctx, left, top, right - left, height, radius)
  ctx.fillStyle = theme.navy700
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.navy600
  ctx.stroke()
}

/** Tüm satırlarda ortak olan yatay ölçüler */
export interface RowGeometry {
  /** Sol işaretin (sıra numarası / sonuç işareti) merkezi ve yarıçapı */
  markX: number
  markR: number
  textLeft: number
  /** Takım adları ve alt satırın kullanabileceği sağ sınır */
  textRight: number
  /** Sağ bloğun (yüzde / skor) sağ kenarı */
  rightX: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Kartın sol işareti ve sağ bloğuna göre metin alanını hesaplar. rightBlockWidth sağ bloğun en geniş hâlidir. */
export function rowGeometry(plan: RowPlan, rightBlockWidth: number): RowGeometry {
  const { left, right } = SAFE_AREA
  const markR = plan.mode === 'full' ? clamp(Math.round(plan.rowHeight * 0.16), 22, 34) : plan.rowHeight >= 72 ? 20 : 17
  const markX = left + (plan.mode === 'full' ? 22 : 16) + markR
  const rightX = right - (plan.mode === 'full' ? 26 : 20)
  return { markX, markR, rightX, textLeft: markX + markR + (plan.mode === 'full' ? 22 : 14), textRight: rightX - rightBlockWidth - (plan.mode === 'full' ? 26 : 16) }
}

/**
 * Takım adlarını çizer: tek satır ya da (uzunsa) ev / deplasman olarak iki satır.
 * Geniş düzende adların altında yer kalan alt satır için dikey ortayı döner.
 */
export function drawTeams(
  ctx: Ctx,
  row: { home: string; away: string },
  split: boolean,
  size: number,
  plan: RowPlan,
  x: number,
  width: number,
  mid: number,
): number {
  const measure = (text: string) => ctx.measureText(text).width
  ctx.font = font(800, size)
  const lines = split ? [row.home, row.away] : [fitTeams(row.home, row.away, width, measure)]
  const leading = size * (plan.mode === 'full' ? LEADING.full : LEADING.dense)
  const metaHeight = plan.mode === 'full' ? plan.metaSize * LEADING.meta : 0
  const blockTop = mid - (lines.length * leading + metaHeight) / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme.white
  lines.forEach((line, i) => ctx.fillText(ellipsize(line, width, measure), x, Math.round(blockTop + (i + 0.5) * leading) + 1))
  return Math.round(blockTop + lines.length * leading + metaHeight / 2) + 1
}

/** Tüm kartlar için ortak takım adı boyutunu ve hangi maçların iki satıra bölüneceğini belirler. */
export function fitTeamsOnCanvas(ctx: Ctx, plan: RowPlan, rows: { home: string; away: string }[], width: number): TeamFit {
  return fitTeamNames(plan, rows, width, (text, size) => {
    ctx.font = font(800, size)
    return ctx.measureText(text).width
  })
}

/** "21:00  ·  England · PDL": saat ve sığacak biçimde kısaltılmış lig */
function metaText(ctx: Ctx, row: StoryRow, width: number): string {
  const measure = (text: string) => ctx.measureText(text).width
  const prefix = row.time ? `${row.time}${row.league ? '  ·  ' : ''}` : ''
  return prefix + fitLeague(row.league, width - measure(prefix), measure)
}

function drawRank(ctx: Ctx, rank: number, geometry: RowGeometry, mid: number) {
  ctx.beginPath()
  ctx.arc(geometry.markX, mid, geometry.markR, 0, Math.PI * 2)
  ctx.fillStyle = theme.navy600
  ctx.fill()
  ctx.fillStyle = theme.white
  ctx.font = font(800, Math.round(geometry.markR * 1.08))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(rank), geometry.markX, mid + 1)
}

const starRadius = (plan: RowPlan): number => (plan.mode === 'full' ? clamp(Math.round(plan.rowHeight * 0.075), 11, 18) : plan.rowHeight >= 72 ? 10 : 9)
/** drawStars'ın beş yıldız için kapladığı genişlik */
const starsWidth = (radius: number): number => radius * 2 + 4 * radius * 2.3

/** Sağ bloğun en geniş hâli: geniş düzende yüzde ile yıldızların genişi, sıkışıkta ikisi yan yana */
function rightBlockWidth(ctx: Ctx, plan: RowPlan): number {
  ctx.font = font(900, plan.percentSize)
  const percentWidth = ctx.measureText('%100').width
  const stars = starsWidth(starRadius(plan))
  return plan.mode === 'full' ? Math.max(percentWidth, stars) : percentWidth + 16 + stars
}

function drawRow(ctx: Ctx, row: StoryRow, rank: number, top: number, plan: RowPlan, geometry: RowGeometry, team: { size: number; split: boolean }) {
  const h = plan.rowHeight
  const mid = top + h / 2
  const full = plan.mode === 'full'
  drawCard(ctx, top, h, full ? Math.min(32, Math.round(h * 0.17)) : 16)
  drawRank(ctx, rank, geometry, mid)

  // Sağ blok: yüzde ve yıldızlar
  const percentText = `%${row.percent}`
  const radius = starRadius(plan)
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.brand
  ctx.font = font(900, plan.percentSize)
  if (full) {
    // Rakam yüksekliği yazı boyutunun yaklaşık %73'üdür; yüzde ve yıldızlar birlikte dikeyde ortalanır.
    const digits = plan.percentSize * 0.73
    const blockTop = mid - (digits + 12 + radius * 2) / 2
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(percentText, geometry.rightX, Math.round(blockTop + digits))
    drawStars(ctx, geometry.rightX, Math.round(blockTop + digits + 12 + radius), radius, row.stars)
  } else {
    ctx.textBaseline = 'middle'
    ctx.fillText(percentText, geometry.rightX, mid + 1)
    drawStars(ctx, geometry.rightX - ctx.measureText('%100').width - 16, mid, radius, row.stars)
  }

  // Sol blok: (sıkışık düzende saat,) takımlar ve geniş düzende altında saat · lig
  let x = geometry.textLeft
  if (!full && row.time) {
    ctx.font = font(600, plan.metaSize)
    ctx.fillStyle = theme.muted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(row.time, x, mid + 1)
    x += ctx.measureText('00:00').width + 14
  }
  const width = geometry.textRight - x
  const metaMid = drawTeams(ctx, row, team.split, team.size, plan, x, width, mid)
  if (full) {
    ctx.font = font(500, plan.metaSize)
    ctx.fillStyle = theme.muted
    ctx.fillText(metaText(ctx, row, width), x, metaMid)
  }
}

/** Uyarı ayarı boş bırakılırsa görselde bu metin yazar */
const disclaimerFor = (texts: StoryTexts): string => texts.disclaimer.trim() || STORY_NOTE

/** Alt bloğun ölçüleri: az maçta büyük; çok maçta küçük ve bağlantılar sığarsa tek satırda */
export function storyFooterStyle(count: number): FooterStyle {
  const { left, right } = SAFE_AREA
  return headerModeFor(count) === 'large'
    ? { left, right, linkSizes: [36, 34, 32, 30, 28, 26], linkLineHeight: 50, disclaimerSizes: [26, 24] }
    : { left, right, linkSizes: [30, 28, 26, 24], linkLineHeight: 42, disclaimerSizes: [24, 22], inlineLinks: count >= 11 }
}

export const STORY_TIMEZONE_NOTE = 'Saatler TSİ'

/**
 * 1080x1920 tuvale kategori Story görselini çizer: üst blok, maç kartları ve alt
 * blok (Telegram, Instagram, uyarı). Kart yüksekliği ve yazı boyutları maç sayısına
 * göre ölçeklenir; tüm içerik güvenli alanda (250–1670 px) kalır.
 */
export function drawStory(ctx: Ctx, data: StoryData, logo: CanvasImageSource | null, texts: StoryTexts = DEFAULT_STORY_TEXTS): void {
  drawBackground(ctx)
  const count = data.rows.length
  const mode = headerModeFor(count)
  drawStoryHeader(ctx, logo, mode, {
    lead: 'GÜNÜN',
    title: data.categoryLabel,
    tail: 'ÖNERİLERİ',
    sub: [
      { text: data.description, color: theme.white, weight: 600 },
      { text: `${data.dateLabel}  •  ${count} maç  •  ${STORY_TIMEZONE_NOTE}`, color: theme.muted, weight: 600 },
    ],
  })

  const footerStyle = storyFooterStyle(count)
  const footer = layoutFooter(ctx, { ...texts, disclaimer: disclaimerFor(texts) }, footerStyle)
  const footerTop = SAFE_AREA.bottom - footerHeight(footer)

  const layout = (plan: RowPlan) => {
    const geometry = rowGeometry(plan, rightBlockWidth(ctx, plan))
    // Sıkışık düzende saat takımların solunda yer kaplar.
    ctx.font = font(600, plan.metaSize)
    const timeWidth = plan.mode === 'dense' && data.rows.some((r) => r.time) ? ctx.measureText('00:00').width + 14 : 0
    return { plan, geometry, team: fitTeamsOnCanvas(ctx, plan, data.rows, geometry.textRight - geometry.textLeft - timeWidth) }
  }
  let fitted = layout(planRows(count, HEADER[mode].bottom, footerTop - FOOTER_GAP))
  // Uzun adlar geniş düzene sığmıyorsa adları kesmek yerine sıkışık düzene geçilir.
  if (fitted.team.overflow && fitted.plan.mode === 'full' && fitted.plan.rowHeight < 150) fitted = layout(asDense(fitted.plan))
  const { plan, geometry, team } = fitted
  data.rows.forEach((row, i) =>
    drawRow(ctx, row, i + 1, plan.top + i * (plan.rowHeight + plan.gap), plan, geometry, { size: team.size, split: team.split[i] }),
  )

  drawFooter(ctx, footer, footerTop, footerStyle)
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    // Logo yüklenemezse görsel yine üretilir; rozette yazı görünür.
    image.onerror = () => resolve(null)
    image.src = src
  })

/**
 * 1080x1920 tuvali hazırlar (gömülü yazı tipi + logo), verilen çizimi uygular
 * ve PNG olarak verir. Tüm story görselleri bu yoldan üretilir.
 */
export async function renderStoryPng(draw: (ctx: Ctx, logo: CanvasImageSource | null) => void): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = STORY.width
  canvas.height = STORY.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tarayıcı görsel oluşturmayı desteklemiyor.')
  const [logo] = await Promise.all([loadImage('./logo.png'), loadStoryFonts()])
  draw(ctx, logo)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Görsel oluşturulamadı.'))), 'image/png'),
  )
}

/** Story görselini PNG olarak üretir. */
export const createStoryPng = (data: StoryData, texts?: StoryTexts): Promise<Blob> =>
  renderStoryPng((ctx, logo) => drawStory(ctx, data, logo, texts))
