// Kategori kayıt defteri. Yeni kategori eklemek için buraya bir kayıt ve
// services/analysis/calculators altına bir hesaplayıcı eklemek yeterlidir;
// menü, eşik ayarı, görsel ve istatistik bu listeden beslenir.

export type CategoryId =
  | 'over25'
  | 'ht05'
  | 'btts'
  | 'over25btts'
  | 'sh05'
  | 'over35'
  | 'over45'
  | 'ht15'
  | 'corners85'
  | 'corners95'
  | 'corners105'
  | 'cards35'
  | 'cards45'
  | 'homeWin15'
  | 'homeWin25'
  | 'awayWin15'
  | 'awayWin25'

export type GroupId = 'bolgol' | 'corners' | 'cards' | 'sidegoals'

export interface CategoryDef {
  id: CategoryId
  /** Kart, görsel ve istatistikte görünen ad */
  label: string
  /** Adres çubuğundaki kısa ad: #/kategori/<slug> */
  slug: string
  /** Varsayılan minimum yüzde; admin panelinden değiştirilir */
  defaultThreshold: number
  /** Aynı gruptaki kategoriler tek sayfada ayrı listeler olarak gösterilir */
  group?: GroupId
  /** Yüzde -> yıldız basamakları; verilmezse DEFAULT_STAR_STEPS kullanılır */
  starSteps?: StarSteps
  /**
   * Bu kategorinin dayandığı verinin örneklemi CSV'den çıkarılamıyor
   * (korner ve kart). Güvenilirlik "ölçülemedi" görünür, temkinli yüzde üretilmez.
   */
  sampleUnmeasured?: true
  /**
   * Yüzde, maç örneklemine değil piyasa oranlarına kalibre edilmiş skor
   * modeline dayanır (Taraf & Gol). Temkinli yüzde üretilmez.
   */
  marketBased?: true
}

/** Örnekleme göre düzeltilmiş (temkinli) sıralama bu kategoride uygulanabilir mi */
export const supportsCautious = (category: CategoryDef): boolean =>
  !category.sampleUnmeasured && !category.marketBased

/** [5 yıldız, 4 yıldız, 3 yıldız, 2 yıldız] için alt sınır yüzdeleri; altı 1 yıldız */
export type StarSteps = readonly [number, number, number, number]

export const DEFAULT_STAR_STEPS: StarSteps = [80, 75, 70, 60]
const SIDE_OVER15_STARS: StarSteps = [70, 65, 60, 55]
const SIDE_OVER25_STARS: StarSteps = [60, 55, 50, 45]

export interface GroupDef {
  id: GroupId
  label: string
  /** #/<slug> */
  slug: string
}

export const MAX_MATCHES_PER_CATEGORY = 15
export const HOME_PREVIEW_COUNT = 5

export const GROUPS: GroupDef[] = [
  { id: 'bolgol', label: 'BOL GOL', slug: 'bol-gol' },
  { id: 'corners', label: 'KORNER', slug: 'korner' },
  { id: 'cards', label: 'KART', slug: 'kart' },
  { id: 'sidegoals', label: 'TARAF & GOL', slug: 'taraf-gol' },
]

export const CATEGORIES: CategoryDef[] = [
  { id: 'over25', label: '2.5 ÜST', slug: '2-5-ust', defaultThreshold: 75 },
  { id: 'ht05', label: 'İLK YARI 0.5 ÜST', slug: 'iy-0-5-ust', defaultThreshold: 80 },
  { id: 'btts', label: 'KG VAR', slug: 'kg-var', defaultThreshold: 80 },
  // xG'den Poisson ile gerçek ortak olasılık hesaplandığı için eşik ve yıldız basamakları daha düşük.
  {
    id: 'over25btts',
    label: '2.5 ÜST & KG VAR',
    slug: '2-5-ust-kg-var',
    defaultThreshold: 55,
    starSteps: [70, 65, 60, 55],
  },
  { id: 'sh05', label: '2. YARI 0.5 ÜST', slug: '2y-0-5-ust', defaultThreshold: 75 },
  { id: 'over35', label: '3.5 ÜST', slug: '3-5-ust', defaultThreshold: 70, group: 'bolgol' },
  { id: 'over45', label: '4.5 ÜST', slug: '4-5-ust', defaultThreshold: 60, group: 'bolgol' },
  { id: 'ht15', label: 'İLK YARI 1.5 ÜST', slug: 'iy-1-5-ust', defaultThreshold: 60, group: 'bolgol' },
  { id: 'corners85', label: 'KORNER 8.5 ÜST', slug: 'korner-8-5-ust', defaultThreshold: 70, group: 'corners', sampleUnmeasured: true },
  { id: 'corners95', label: 'KORNER 9.5 ÜST', slug: 'korner-9-5-ust', defaultThreshold: 70, group: 'corners', sampleUnmeasured: true },
  {
    id: 'corners105',
    label: 'KORNER 10.5 ÜST',
    slug: 'korner-10-5-ust',
    defaultThreshold: 70,
    group: 'corners',
    sampleUnmeasured: true,
  },
  { id: 'cards35', label: 'KART 3.5 ÜST', slug: 'kart-3-5-ust', defaultThreshold: 70, group: 'cards', sampleUnmeasured: true },
  { id: 'cards45', label: 'KART 4.5 ÜST', slug: 'kart-4-5-ust', defaultThreshold: 70, group: 'cards', sampleUnmeasured: true },
  // Taraf & Gol: ortak olasılık olduğu için eşikler ve yıldız basamakları düşüktür.
  {
    id: 'homeWin15',
    label: 'EV KAZANIR & 1.5 ÜST',
    slug: 'ev-kazanir-1-5-ust',
    defaultThreshold: 55,
    group: 'sidegoals',
    starSteps: SIDE_OVER15_STARS,
    marketBased: true,
  },
  {
    id: 'homeWin25',
    label: 'EV KAZANIR & 2.5 ÜST',
    slug: 'ev-kazanir-2-5-ust',
    defaultThreshold: 45,
    group: 'sidegoals',
    starSteps: SIDE_OVER25_STARS,
    marketBased: true,
  },
  {
    id: 'awayWin15',
    label: 'DEPLASMAN KAZANIR & 1.5 ÜST',
    slug: 'deplasman-kazanir-1-5-ust',
    defaultThreshold: 55,
    group: 'sidegoals',
    starSteps: SIDE_OVER15_STARS,
    marketBased: true,
  },
  {
    id: 'awayWin25',
    label: 'DEPLASMAN KAZANIR & 2.5 ÜST',
    slug: 'deplasman-kazanir-2-5-ust',
    defaultThreshold: 45,
    group: 'sidegoals',
    starSteps: SIDE_OVER25_STARS,
    marketBased: true,
  },
]

export const getCategory = (id: CategoryId): CategoryDef => {
  const found = CATEGORIES.find((c) => c.id === id)
  if (!found) throw new Error(`Bilinmeyen kategori: ${id}`)
  return found
}

export const isCategoryId = (id: string): id is CategoryId => CATEGORIES.some((c) => c.id === id)

export const getCategoryBySlug = (slug: string): CategoryDef | undefined =>
  CATEGORIES.find((c) => c.slug === slug)

export const getGroupBySlug = (slug: string): GroupDef | undefined => GROUPS.find((g) => g.slug === slug)

export const standaloneCategories = (): CategoryDef[] => CATEGORIES.filter((c) => !c.group)

export const categoriesInGroup = (group: GroupId): CategoryDef[] => CATEGORIES.filter((c) => c.group === group)

export const defaultThresholds = (): Record<CategoryId, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c.id, c.defaultThreshold])) as Record<CategoryId, number>
