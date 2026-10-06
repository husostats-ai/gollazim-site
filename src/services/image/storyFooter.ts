import { theme } from '../../config/theme'
import type { StoryTexts } from '../../config/storyTexts'
import { font, type Ctx } from './storyGenerator'
import { ellipsize, pickFontSize, wrapText } from './storyLayout'

// Story görsellerinin alt bloğu: (isteğe bağlı not + ayırıcı çizgi), Telegram ve
// Instagram satırları, uyarı. Boş bırakılan metnin satırı hiç oluşmaz.

export const FOOTER_LABELS = { telegram: 'Telegram:', instagram: 'Instagram:' } as const

export interface FooterStyle {
  left: number
  right: number
  /** Bağlantıların üstünde, ayırıcı çizgiyle ayrılan not (günlük görsel) */
  note?: string
  /** Bağlantı yazı boyutları, büyükten küçüğe; uzun bağlantı küçülür */
  linkSizes: number[]
  linkLineHeight: number
  disclaimerSizes: number[]
  /** İki bağlantı tek satıra sığıyorsa yan yana yazılır (yer kazanmak için) */
  inlineLinks?: boolean
}

interface Link {
  label: string
  value: string
}

export type FooterItem =
  | { kind: 'text'; lines: string[]; size: number; weight: number; lineHeight: number; gapBefore: number }
  | { kind: 'rule'; gapBefore: number }
  | { kind: 'link'; label: string; value: string; size: number; lineHeight: number; gapBefore: number }
  | { kind: 'links'; links: Link[]; size: number; lineHeight: number; gapBefore: number }

const INLINE_GAP = 40

/** Alt bloğun satırlarını ölçer; boş bırakılan metinlerin satırı hiç oluşmaz. */
export function layoutFooter(ctx: Ctx, texts: Pick<StoryTexts, 'telegram' | 'instagram' | 'disclaimer'>, style: FooterStyle): FooterItem[] {
  const width = style.right - style.left
  const measure = (text: string) => ctx.measureText(text).width
  const items: FooterItem[] = []

  if (style.note) {
    ctx.font = font(500, 28)
    items.push({ kind: 'text', lines: wrapText(style.note, width, measure), size: 28, weight: 500, lineHeight: 38, gapBefore: 0 })
    // Ayırıcı çizgi yalnızca altında bir şey varsa çizilir.
    if ([texts.telegram, texts.instagram, texts.disclaimer].some((t) => t.trim() !== '')) items.push({ kind: 'rule', gapBefore: 16 })
  }

  const links: Link[] = [
    { label: FOOTER_LABELS.telegram, value: texts.telegram.trim() },
    { label: FOOTER_LABELS.instagram, value: texts.instagram.trim() },
  ].filter((link) => link.value !== '')
  const linkWidth = (link: Link, size: number) => {
    ctx.font = font(800, size)
    const labelWidth = measure(`${link.label} `)
    ctx.font = font(600, size)
    return labelWidth + measure(link.value)
  }
  const firstGap = style.note ? 10 : 0
  const inlineSize =
    style.inlineLinks && links.length === 2
      ? style.linkSizes.find((s) => linkWidth(links[0], s) + INLINE_GAP + linkWidth(links[1], s) <= width)
      : undefined
  if (inlineSize !== undefined) {
    items.push({ kind: 'links', links, size: inlineSize, lineHeight: style.linkLineHeight, gapBefore: firstGap })
  } else {
    links.forEach((link, i) => {
      // Uzun bağlantı önce küçülür; en küçük boyutta da sığmazsa sonundan kırpılır.
      const size = pickFontSize(style.linkSizes, (s) => linkWidth(link, s) <= width)
      items.push({ kind: 'link', ...link, size, lineHeight: style.linkLineHeight, gapBefore: i === 0 ? firstGap : 0 })
    })
  }

  const disclaimer = texts.disclaimer.trim()
  if (disclaimer !== '') {
    const size = pickFontSize(style.disclaimerSizes, (s) => {
      ctx.font = font(500, s)
      return measure(disclaimer) <= width
    })
    ctx.font = font(500, size)
    items.push({
      kind: 'text',
      lines: wrapText(disclaimer, width, measure),
      size,
      weight: 500,
      lineHeight: size + 8,
      gapBefore: items.length > 0 ? 12 : 0,
    })
  }
  return items
}

const itemHeight = (item: FooterItem): number =>
  item.gapBefore + (item.kind === 'rule' ? 2 : item.kind === 'text' ? item.lines.length * item.lineHeight : item.lineHeight)

export const footerHeight = (items: FooterItem[]): number => items.reduce((sum, item) => sum + itemHeight(item), 0)

/** Harflerin taban çizgisinin altına inen kuyruğu (ş, ğ, y) için satır altında bırakılan pay */
const DESCENT = 0.28

export function drawFooter(ctx: Ctx, items: FooterItem[], top: number, style: Pick<FooterStyle, 'left' | 'right'>) {
  const { left, right } = style
  const measure = (text: string) => ctx.measureText(text).width
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const drawLink = (link: Link, size: number, x: number, baseline: number, maxRight: number): number => {
    ctx.font = font(800, size)
    ctx.fillStyle = theme.brand
    ctx.fillText(link.label, x, baseline)
    const valueX = x + measure(`${link.label} `)
    ctx.font = font(600, size)
    ctx.fillStyle = theme.white
    const value = ellipsize(link.value, maxRight - valueX, measure)
    ctx.fillText(value, valueX, baseline)
    return valueX + measure(value)
  }
  let y = top
  for (const item of items) {
    y += item.gapBefore
    if (item.kind === 'rule') {
      ctx.fillStyle = theme.navy600
      ctx.fillRect(left, y, right - left, 2)
      y += 2
    } else if (item.kind === 'link') {
      drawLink(item, item.size, left, y + item.lineHeight - Math.round(item.size * DESCENT) - 4, right)
      y += item.lineHeight
    } else if (item.kind === 'links') {
      const baseline = y + item.lineHeight - Math.round(item.size * DESCENT) - 4
      let x = left
      for (const link of item.links) x = drawLink(link, item.size, x, baseline, right) + INLINE_GAP
      y += item.lineHeight
    } else {
      ctx.font = font(item.weight, item.size)
      ctx.fillStyle = theme.muted
      for (const line of item.lines) {
        ctx.fillText(ellipsize(line, right - left, measure), left, y + item.lineHeight - Math.round(item.size * DESCENT) - 2)
        y += item.lineHeight
      }
    }
  }
}
