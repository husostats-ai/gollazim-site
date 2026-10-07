import { CATEGORIES, GROUPS, type CategoryId } from '../config/categories'
import type { MemberDay, MemberList } from '../services/member/payload'
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

export const categoryLabel = (categoryId: string): string => CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId

/**
 * Kartta ikinci yüzdenin adı: ana gol kategorilerinde "Model", Taraf & Gol listelerinde
 * "İkinci hesap" (orada ikinci yüzde aynı olasılığın başka bir yöntemle hesabıdır).
 */
export const secondPercentLabel = (categoryId: CategoryId): string => (CATEGORIES.find((c) => c.id === categoryId)?.group === 'sidegoals' ? 'İkinci hesap' : 'Model')
