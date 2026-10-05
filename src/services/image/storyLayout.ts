// Story görselinin ölçüleri ve metin sığdırma yardımcıları. Çizimden
// bağımsızdır; böylece "15 maç taşmıyor mu" gibi kurallar test edilebilir.

export const STORY = { width: 1080, height: 1920 } as const

/** Maç listesinin çizildiği dikey alan; üstü ve altı Instagram arayüzü için boş bırakılır */
export const LIST_AREA = { top: 560, bottom: 1610, left: 60, right: 1020 } as const

export interface RowLayout {
  /** İki satırlı geniş düzen mi, tek satırlı sıkışık düzen mi */
  roomy: boolean
  rowHeight: number
  gap: number
  /** İlk satırın üst kenarı; liste başlığın hemen altından başlar */
  top: number
}

/** Geniş düzende yazı boyutlarının tasarlandığı satır yüksekliği */
export const STANDARD_ROW_HEIGHT = 150

/** Bu yükseklikten itibaren takım adları iki satıra (ev / deplasman) yazılır */
export const TALL_ROW_HEIGHT = 180

/** Az maçta kartlar büyür ki görselin altı boş kalmasın */
const maxRowHeight = (count: number): number => (count === 1 ? 220 : count === 2 ? 200 : count === 3 ? 180 : STANDARD_ROW_HEIGHT)
const ROOMY_MIN_HEIGHT = 96

/** Satır yüksekliğini maç sayısına göre ayarlar; liste hiçbir zaman alanın dışına taşmaz. */
export function layoutRows(count: number): RowLayout {
  const available = LIST_AREA.bottom - LIST_AREA.top
  const n = Math.max(1, count)
  const roomyGap = 14
  const roomyHeight = Math.min(maxRowHeight(n), Math.floor((available - roomyGap * (n - 1)) / n))
  const roomy = roomyHeight >= ROOMY_MIN_HEIGHT
  const gap = roomy ? roomyGap : 8
  const rowHeight = roomy ? roomyHeight : Math.floor((available - gap * (n - 1)) / n)
  return { roomy, rowHeight, gap, top: LIST_AREA.top }
}

export type Measure = (text: string) => number

const ELLIPSIS = '…'

/** Metin genişliğe sığmıyorsa sonundan kırpar ve "…" ekler. */
export function ellipsize(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text
  const chars = [...text]
  while (chars.length > 1 && measure(chars.join('').trimEnd() + ELLIPSIS) > maxWidth) chars.pop()
  return chars.join('').trimEnd() + ELLIPSIS
}

export const TEAM_SEPARATOR = ' – '

/**
 * "Ev – Deplasman" metnini genişliğe sığdırır. Sığmıyorsa iki takım adı ayrı
 * ayrı kısaltılır; böylece uzun bir ev sahibi adı deplasmanı ekrandan itmez.
 * Kısa olan takım kullanmadığı yeri diğerine bırakır.
 */
export function fitTeams(home: string, away: string, maxWidth: number, measure: Measure): string {
  const full = home + TEAM_SEPARATOR + away
  if (measure(full) <= maxWidth) return full
  const each = (maxWidth - measure(TEAM_SEPARATOR)) / 2
  const homeWidth = measure(home)
  const awayWidth = measure(away)
  const homeMax = awayWidth < each ? each + (each - awayWidth) : each
  const awayMax = homeWidth < each ? each + (each - homeWidth) : each
  return ellipsize(home, homeMax, measure) + TEAM_SEPARATOR + ellipsize(away, awayMax, measure)
}

/** Verilen boyutlardan metnin sığdığı ilk (en büyük) yazı boyutu; hiçbiri sığmazsa en küçüğü */
export function pickFontSize(sizes: number[], fits: (size: number) => boolean): number {
  return sizes.find(fits) ?? sizes[sizes.length - 1]
}
