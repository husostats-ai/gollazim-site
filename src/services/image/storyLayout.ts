// Story görselinin ölçüleri ve metin sığdırma yardımcıları. Çizimden
// bağımsızdır; böylece "15 maç taşmıyor mu" gibi kurallar test edilebilir.

export const STORY = { width: 1080, height: 1920 } as const

export const TEAM_SEPARATOR = ' – '

/** Instagram arayüzünün kapattığı üst ve alt şeritlerin dışında kalan alan; tüm içerik bunun içinde kalır */
export const SAFE_AREA = { top: 250, bottom: 1670, left: 60, right: 1020 } as const

/** Üst blok: az maçta büyük, çok maçta yer açmak için küçük */
export type HeaderMode = 'large' | 'compact'

export const headerModeFor = (count: number): HeaderMode => (count <= 5 ? 'large' : 'compact')

/** Üst bloğun ölçüleri (piksel). Metinlerde baseline satırın taban çizgisidir. */
export const HEADER = {
  large: {
    badge: { top: 252, size: 200 },
    textGap: 34,
    lead: { size: 46, baseline: 298 },
    title: { sizes: [84, 76, 68, 60, 54, 48, 44, 40, 36], baseline: 386 },
    tail: { size: 46, baseline: 446 },
    /** Tek satırda bu boyutun altına inen uzun başlık "&" işaretinden ikiye bölünür */
    splitBelow: 54,
    split: { sizes: [52, 48, 44, 40], baselines: [352, 406], tailBaseline: 458 },
    sub: [
      { sizes: [34, 32, 30, 28], baseline: 512 },
      { sizes: [30, 28, 26], baseline: 558 },
    ],
    bottom: 586,
  },
  compact: {
    badge: { top: 252, size: 150 },
    textGap: 28,
    lead: { size: 34, baseline: 284 },
    title: { sizes: [62, 56, 50, 46, 42, 38, 34, 30], baseline: 346 },
    tail: { size: 34, baseline: 392 },
    splitBelow: 40,
    split: { sizes: [38, 34, 30], baselines: [322, 360], tailBaseline: 398 },
    sub: [
      { sizes: [30, 28, 26, 24], baseline: 442 },
      { sizes: [26, 24, 22], baseline: 480 },
    ],
    bottom: 504,
  },
} as const

/** Kartlar ile alt blok arasındaki en az boşluk */
export const FOOTER_GAP = 22

/** Satır arası oranları: yazı boyutunun katı */
const FULL_LEADING = 1.16
const DENSE_LEADING = 1.12
const META_LEADING = 1.35
/** Geniş düzende kartın üst ve alt iç boşluğu */
const FULL_PADDING = 12

export interface RowPlan {
  /** full: takımlar + altında saat/lig satırı; dense: saat ve takımlar tek sırada, lig yok */
  mode: 'full' | 'dense'
  rowHeight: number
  gap: number
  /** İlk kartın üst kenarı; kartlar alanı doldurmuyorsa blok dikeyde ortalanır */
  top: number
  /** Takım adı için hedef yazı boyutu; tüm kartlarda aynı boyut kullanılır */
  teamSize: number
  /** Uzun adlar için inilebilecek en küçük ortak boyut */
  teamMinSize: number
  /** Saat / lig satırı */
  metaSize: number
  percentSize: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Az maçta kart sınırsız büyümesin; kalan boşluk kartların üstüne ve altına eşit dağılır */
const maxRowHeight = (count: number): number => (count === 1 ? 420 : count === 2 ? 340 : count === 3 ? 270 : 230)

/** Bu yükseklikten itibaren kartta saat/lig satırı için yer vardır */
export const FULL_MODE_MIN_HEIGHT = 110

/**
 * Kart yüksekliğini ve yazı boyutlarını maç sayısına göre belirler: az maçta
 * kartlar büyük ve ferah, çok maçta sıkışık. Kartlar hiçbir zaman [top, bottom] dışına taşmaz.
 */
export function planRows(count: number, top: number, bottom: number): RowPlan {
  const n = Math.max(1, count)
  const available = bottom - top
  const gap = n <= 6 ? 16 : n <= 10 ? 12 : 8
  const rowHeight = Math.min(maxRowHeight(n), Math.floor((available - gap * (n - 1)) / n))
  const block = rowHeight * n + gap * (n - 1)
  const start = top + Math.floor((available - block) / 2)
  const h = rowHeight
  if (h >= FULL_MODE_MIN_HEIGHT) {
    return {
      mode: 'full',
      rowHeight,
      gap,
      top: start,
      teamSize: clamp(Math.round(h * 0.27), h >= 150 ? 40 : 30, 68),
      // Büyük kartta 40 px'in altına yalnızca tek bir takım adı 40 px'te satıra sığmıyorsa inilir.
      teamMinSize: h >= 150 ? 30 : 26,
      metaSize: clamp(Math.round(h * 0.15), 24, 36),
      percentSize: clamp(Math.round(h * 0.42), 64, 128),
    }
  }
  return densePlan({ rowHeight, gap, top: start })
}

/** Sıkışık düzen: saat ve takımlar tek sırada, lig satırı yok */
function densePlan(base: Pick<RowPlan, 'rowHeight' | 'gap' | 'top'>): RowPlan {
  const h = base.rowHeight
  return {
    ...base,
    mode: 'dense',
    teamSize: clamp(Math.round(h * 0.36), 24, 34),
    teamMinSize: 22,
    metaSize: h >= 72 ? 24 : 22,
    percentSize: clamp(Math.round(h * 0.56), 36, 60),
  }
}

/**
 * Geniş düzende uzun takım adları iki satıra bölünüp alt satırla birlikte karta
 * sığmıyorsa (7–9 maç) görsel sıkışık düzene çevrilir: lig satırı düşer, adlar kesilmez.
 */
export const asDense = (plan: RowPlan): RowPlan => densePlan(plan)

/** Bu yazı boyutunda iki satırlık (ev / deplasman) takım adı karta sığar mı */
export function twoLinesFit(plan: RowPlan, size: number): boolean {
  return plan.mode === 'full'
    ? 2 * size * FULL_LEADING + plan.metaSize * META_LEADING + 2 * FULL_PADDING <= plan.rowHeight
    : 2 * size * DENSE_LEADING + 8 <= plan.rowHeight
}

export const LEADING = { full: FULL_LEADING, dense: DENSE_LEADING, meta: META_LEADING } as const

export interface TeamFit {
  /** Hiçbir ortak boyutta adlar kesilmeden sığmadı; çizimde uzun adlar sonundan kırpılır */
  overflow: boolean
  /** Görseldeki tüm kartlarda kullanılan takım adı boyutu */
  size: number
  /** Her maç için: "Ev – Deplasman" tek satıra sığmadığı için iki satıra bölünecek mi */
  split: boolean[]
}

/**
 * Takım adları küçültülmek yerine iki satıra bölünür ve tüm kartlarda aynı boyut
 * kullanılır. Hedef boyuttan başlanır; ancak tek bir takım adı satıra sığmıyorsa ya da
 * iki satır karta sığmıyorsa boyut, bütün kartlar için birlikte küçülür.
 */
export function fitTeamNames(
  plan: RowPlan,
  rows: { home: string; away: string }[],
  width: number,
  measureAt: (text: string, size: number) => number,
): TeamFit {
  const splitsAt = (size: number) => rows.map((r) => measureAt(r.home + TEAM_SEPARATOR + r.away, size) > width)
  for (let size = plan.teamSize; size >= plan.teamMinSize; size -= 2) {
    const split = splitsAt(size)
    const namesFit = rows.every((r, i) => !split[i] || (measureAt(r.home, size) <= width && measureAt(r.away, size) <= width))
    if (namesFit && (!split.some(Boolean) || twoLinesFit(plan, size))) return { size, split, overflow: false }
  }
  // En küçük boyutta da sığmayan ad çizimde sonundan kırpılır; iki satır sığmıyorsa tek satırda kalır.
  const size = plan.teamMinSize
  return { size, split: twoLinesFit(plan, size) ? splitsAt(size) : rows.map(() => false), overflow: true }
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

/**
 * Metni sözcük aralarından satırlara böler; her satır genişliğe sığar. Tek
 * başına sığmayan bir sözcük kendi satırında kalır (çağıran kırpar ya da küçültür).
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && measure(candidate) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}
