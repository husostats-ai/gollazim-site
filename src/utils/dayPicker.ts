import { asUtc, formatLongDate, formatMonth, shiftDate } from './format'

// Gün seçicinin saf tarih işlevleri: hızlı düğmeler (son 7 gün) ve "Önceki günler" takvimi.
// Bütün hesaplar YYYY-MM-DD metni ve UTC üzerinden yapılır; tarayıcının yerel saati kullanılmaz.
// "Bugün" çağıran taraftan gelir (todayInAppZone, Europe/Istanbul).

/** Hızlı düğme olarak gösterilen gün aralığı: bugün ve önceki 6 gün */
export const QUICK_DAY_COUNT = 7

export interface DateSplit {
  /** Hızlı düğmeler: bugün − 6 … bugün arasındaki ve ileri tarihli verili günler (gelen sıra korunur) */
  quick: string[]
  /** Daha eski verili günler; yalnızca takvimden seçilir */
  older: string[]
  /** Seçili gün eski günlerdense o gün (düğme satırında ayrıca gösterilir), değilse null */
  pinned: string | null
}

export function splitDates(dates: string[], today: string, selected: string | null): DateSplit {
  const first = shiftDate(today, -(QUICK_DAY_COUNT - 1))
  const older = dates.filter((d) => d < first)
  return {
    quick: dates.filter((d) => d >= first),
    older,
    pinned: selected !== null && older.includes(selected) ? selected : null,
  }
}

/** "2026-10-14" -> "2026-10" */
export const monthOf = (date: string): string => date.slice(0, 7)

/** Ay anahtarını verilen kadar ay kaydırır: ("2026-12", 1) -> "2027-01" */
export const shiftMonth = (month: string, delta: number): string => {
  const [year, m] = month.split('-').map(Number)
  const index = year * 12 + (m - 1) + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

const lastDayOf = (month: string): string => shiftDate(`${shiftMonth(month, 1)}-01`, -1)

/** Ayın takvim ızgarası: Pazartesi'den başlayan 6 hafta × 7 gün (baş ve sondaki komşu ay günleri dahil) */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`
  const start = shiftDate(first, -((asUtc(first).getUTCDay() + 6) % 7))
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => shiftDate(start, week * 7 + day)))
}

const weekdayShort = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' })
const weekdayLong = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'UTC' })
/** Takvim başlığındaki gün adları, Pazartesi'den Pazar'a: { short: "Pzt", long: "Pazartesi" } */
export const WEEKDAYS = Array.from({ length: 7 }, (_, i) => {
  // 2026-10-12 bir Pazartesi'dir.
  const day = asUtc(shiftDate('2026-10-12', i))
  return { short: weekdayShort.format(day), long: weekdayLong.format(day) }
})

/** "Ekim 2026" */
export const monthTitle = (month: string): string => formatMonth(month)

/** Takvimde ekran okuyucunun okuduğu gün adı: "3 Ekim 2026 Cumartesi, bugün, veri yok" */
export const calendarDayLabel = (date: string, today: string, hasData: boolean): string =>
  `${formatLongDate(date)}${date === today ? ', bugün' : ''}${hasData ? '' : ', veri yok'}`

/** Takvimin gezilebildiği aralık: verisi olan en eski ayın ilk günü … en yeni ayın son günü */
export interface CalendarRange {
  min: string
  max: string
}

export function calendarRange(dates: string[]): CalendarRange | null {
  if (dates.length === 0) return null
  const sorted = [...dates].sort()
  return { min: `${monthOf(sorted[0])}-01`, max: lastDayOf(monthOf(sorted[sorted.length - 1])) }
}

const clamp = (date: string, range: CalendarRange): string => (date < range.min ? range.min : date > range.max ? range.max : date)

/** Ayın aynı günü (ayda o kadar gün yoksa son günü): ("2026-10-31", 1) -> "2026-11-30" */
const sameDayOfMonth = (date: string, delta: number): string => {
  const month = shiftMonth(monthOf(date), delta)
  const last = lastDayOf(month)
  const day = `${month}-${date.slice(8)}`
  return day > last ? last : day
}

/** Önceki/sonraki ay düğmesi: odak ayın aynı gününe geçer (aralık dışına çıkmaz) */
export const shiftFocusMonth = (date: string, delta: number, range: CalendarRange): string => clamp(sameDayOfMonth(date, delta), range)

/**
 * Takvimde tuşun götürdüğü gün: oklar ±1 gün / ±1 hafta, PageUp/PageDown ±1 ay,
 * Home/End haftanın başı (Pazartesi) / sonu (Pazar). Aralık dışına çıkmaz; başka tuşta null.
 */
export function keyTarget(date: string, key: string, range: CalendarRange): string | null {
  const weekday = (asUtc(date).getUTCDay() + 6) % 7
  const next: Record<string, () => string> = {
    ArrowLeft: () => shiftDate(date, -1),
    ArrowRight: () => shiftDate(date, 1),
    ArrowUp: () => shiftDate(date, -7),
    ArrowDown: () => shiftDate(date, 7),
    PageUp: () => sameDayOfMonth(date, -1),
    PageDown: () => sameDayOfMonth(date, 1),
    Home: () => shiftDate(date, -weekday),
    End: () => shiftDate(date, 6 - weekday),
  }
  return key in next ? clamp(next[key](), range) : null
}
