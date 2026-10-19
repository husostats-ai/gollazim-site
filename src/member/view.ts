import { CATEGORIES, GROUPS, type CategoryId } from '../config/categories'
import type { MemberDay, MemberItem, MemberList, MemberMatch } from '../services/member/payload'
import { toAppDateTime } from '../utils/date'
import { formatDateChip, formatDay, formatPlainDate } from '../utils/format'

// Üye sayfasının gösterim yardımcıları. Hesap yapmaz; paketteki değerleri biçimlendirir.

/** "Son güncelleme: 08:16 (TSİ)"; yayın bugün değilse tarihiyle birlikte */
export function updatedText(publishedAt: string, today: string): string {
  const at = toAppDateTime(new Date(publishedAt))
  return `Son güncelleme: ${at.date === today ? '' : `${formatDay(at.date)} `}${at.time} (TSİ)`
}

/** Yayın, verilen saatten eski mi */
export const isStale = (publishedAt: string, now: number, hours: number): boolean => now - new Date(publishedAt).getTime() > hours * 3_600_000

/** Gün düğmesinin metni: "Bugün", "Dün" ya da "3 Eki" */
export const dayChip = (date: string, today: string): string => formatDateChip(date, today)

/** "7 Ekim 2026 analizleri" */
export const dayTitle = (date: string): string => `${formatPlainDate(date)} analizleri`

export interface CategoryChoice {
  categoryId: CategoryId
  label: string
  /** Menüde grubun adı; tek başına duran kategorilerde yoktur */
  group: string | null
  count: number
}

/** Günün en az bir önerisi olan listeleri, kayıt defterindeki sırayla */
export function categoryChoices(day: MemberDay): CategoryChoice[] {
  return day.lists
    .filter((list) => list.items.length > 0)
    .map((list) => {
      const category = CATEGORIES.find((c) => c.id === list.categoryId)!
      return { categoryId: list.categoryId, label: category.label, group: GROUPS.find((g) => g.id === category.group)?.label ?? null, count: list.items.length }
    })
}

/** Seçili kategorinin listesi; seçim bu günde yoksa ilk dolu liste, o da yoksa null */
export function listFor(day: MemberDay, categoryId: CategoryId | null): MemberList | null {
  const filled = day.lists.filter((list) => list.items.length > 0)
  return filled.find((list) => list.categoryId === categoryId) ?? filled[0] ?? null
}

/**
 * Listenin dizilişi. percent: paketteki sıra (yüzdeye göre, varsayılan). time: başlama saatine göre.
 * Yalnızca dizilişi değiştirir; kartlardaki sıra numarası her iki modda da paketteki sıradır.
 */
export type MemberSortMode = 'percent' | 'time'

export const SORT_GROUP_LABEL = 'Sıralama'
export const SORT_LABELS: Record<MemberSortMode, string> = { percent: 'Yüzdeye göre', time: 'Saate göre' }
/** Mod değişince ekran okuyucuya okunan metin */
export const SORT_ANNOUNCE: Record<MemberSortMode, string> = { percent: 'Yüzdeye göre sıralandı', time: 'Saate göre sıralandı' }
/** Saat modunda listenin üstündeki kısa not */
export const TIME_SORT_NOTE = 'Numara, yüzde sırasını gösterir.'

export interface RankedItem {
  item: MemberItem
  /** Paketteki sıra (1'den başlar); diziliş değişse de aynı kalır */
  rank: number
}

/**
 * Listeyi seçili moda göre dizer. Saat modunda: saat artan ("HH:mm", Türkiye saati; gece yarısını geçen
 * maç zaten ertesi günün listesindedir), saati olmayan sona, eşit saatte paketteki sıra.
 */
export function orderItems(items: MemberItem[], matches: MemberMatch[], mode: MemberSortMode): RankedItem[] {
  const ranked = items.map((item, i) => ({ item, rank: i + 1 }))
  if (mode === 'percent') return ranked
  const timeOf = (r: RankedItem): string | null => matches[r.item.match]?.time ?? null
  return ranked.sort((a, b) => {
    const ta = timeOf(a)
    const tb = timeOf(b)
    if (ta !== tb) {
      if (ta === null) return 1
      if (tb === null) return -1
      return ta < tb ? -1 : 1
    }
    return a.rank - b.rank
  })
}

/** Seri başına tutan adım: "2,5"; biten seri yoksa "—" */
export const streakMeanText = (mean: number | null): string => (mean === null ? '—' : mean.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

export const categoryLabel = (categoryId: string): string => CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId

/**
 * Kartta ikinci yüzdenin adı: ana gol kategorilerinde "Model", Taraf & Gol listelerinde
 * "İkinci hesap" (orada ikinci yüzde aynı olasılığın başka bir yöntemle hesabıdır).
 */
export const secondPercentLabel = (categoryId: CategoryId): string => (CATEGORIES.find((c) => c.id === categoryId)?.group === 'sidegoals' ? 'İkinci hesap' : 'Model')

/**
 * Karttaki büyük yüzdenin ne olduğu.
 * history: iki takımın geçmiş maçlarında olayın görülme sıklığı (ev sahibinin iç saha ve
 * deplasmanın dış saha maçlarındaki yüzdelerinin ortalaması); gol, yarı ve korner listeleri.
 * model: geçmiş sıklık değil, bir modelin hesapladığı olasılık (2.5 Üst & KG Var, kart ve
 * Taraf & Gol listeleri).
 */
export type PercentKind = 'history' | 'model'

export function percentKind(categoryId: CategoryId): PercentKind {
  const group = CATEGORIES.find((c) => c.id === categoryId)?.group
  return categoryId === 'over25btts' || group === 'cards' || group === 'sidegoals' ? 'model' : 'history'
}

/** Büyük yüzdenin altındaki sabit etiket (paketten gelmez) */
export const PERCENT_LABELS: Record<PercentKind, string> = {
  history: 'Geçmiş maçlarda görülme sıklığı',
  model: 'Hesaplanan tahmin',
}

/**
 * "Aynı maçın diğer önerileri" satırında, yüzdesi geçmiş sıklık değil hesap olan önerinin yanındaki
 * işaret. Kartın sağ üstündeki "Model %…" (ikinci hesap) ile karışmasın diye "model" denmez.
 */
export const OTHER_COMPUTED_TAG = '(hesaplanan)'

/** Kartların üstündeki sabit açıklama */
export const PERCENT_NOTE = "Yüzdeler geçmiş verilere ve model hesaplarına dayanan özetlerdir; sonucun kesin olduğu anlamına gelmez. Geçmiş veri 'Az' ise yüzde küçük bir örneğe dayanır."

/** %100 ama az maça dayanan yüzde: kesinlik izlenimi vermesin diye sönük gösterilir */
export const isOverstated = (item: Pick<MemberItem, 'percent' | 'reliability'>): boolean => item.percent === 100 && item.reliability === 'low'

/** Karttaki yüzde çubuğunda bir nokta: yalnızca kartta zaten gösterilen bir yüzde */
export interface SpreadPoint {
  kind: 'model' | 'market' | 'history'
  label: string
  value: number
}

/**
 * Yüzde çubuğunun noktaları, karttaki değerlerden (yeni sayı üretilmez). Model: ikinci hesap (varsa);
 * Piyasa: piyasa yüzdesi (varsa); Geçmiş: büyük yüzde, yalnızca geçmiş sıklık olduğu listelerde
 * (hesaplanan tahmin olan listelerde büyük yüzde "Geçmiş" diye gösterilmez). Eksik olan çizilmez.
 */
export function spreadPoints(item: Pick<MemberItem, 'percent' | 'model' | 'mkt'>, categoryId: CategoryId, marketLabel: string): SpreadPoint[] {
  const points: SpreadPoint[] = []
  if (item.model !== null) points.push({ kind: 'model', label: secondPercentLabel(categoryId), value: item.model })
  if (item.mkt !== undefined) points.push({ kind: 'market', label: marketLabel, value: item.mkt })
  if (percentKind(categoryId) === 'history') points.push({ kind: 'history', label: 'Geçmiş', value: item.percent })
  return points
}

/** "Üç yüzde arası fark: 8 puan" / "İki yüzde arası fark: …"; tek nokta varsa null */
export function spreadText(points: SpreadPoint[]): string | null {
  if (points.length < 2) return null
  const values = points.map((p) => p.value)
  return `${points.length === 3 ? 'Üç' : 'İki'} yüzde arası fark: ${Math.max(...values) - Math.min(...values)} puan`
}

/** Diğer analizler bölümünün başlığı */
export const othersTitle = (count: number): string => `Diğer analizler (${count})`

/**
 * Yıldız açıklaması. Kural (analysis/confidence.ts starsFor + hesaplayıcıların maxStars sınırı): yıldız,
 * büyük yüzdenin listeye özgü basamaklardan hangisinde olduğuna göre 1–5 verilir; geçmiş veri Orta ise
 * en çok 4, Az ya da ölçülemiyorsa en çok 3; hesaplar arasında belirgin çelişki varsa ayrıca sınırlanır.
 */
export const STARS_NOTE =
  'Yıldız, kartın büyük yüzdesinin hangi basamakta olduğunu gösterir; geçmiş veri azsa ya da hesaplar arasında belirgin çelişki varsa üst sınırı düşer. Ayrı bir olasılık değildir, sonucu öngörmez.'
export const starsButtonLabel = (count: number): string => `${count} / 5 yıldız, açıklama`
