const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDate = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  weekday: 'long',
  timeZone: 'UTC',
})

export const formatNumber = (value: number): string => decimal.format(value)

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`)

export const shiftDate = (date: string, days: number): string => {
  const d = asUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Bugün / Dün / Yarın, diğer günler için "3 Eki" */
export const formatDateChip = (date: string, today: string): string => {
  if (date === today) return 'Bugün'
  if (date === shiftDate(today, -1)) return 'Dün'
  if (date === shiftDate(today, 1)) return 'Yarın'
  return dayMonth.format(asUtc(date))
}

export const formatLongDate = (date: string): string => longDate.format(asUtc(date))

const rate = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })
const monthYear = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "%77,2"; oran yoksa "—" */
export const formatRate = (value: number | null): string => (value === null ? '—' : `%${rate.format(value)}`)

export const formatDay = (date: string): string => dayMonthYear.format(asUtc(date))

/** Pazartesi tarihinden "5 – 11 Eki 2026" */
export const formatWeek = (monday: string): string =>
  `${dayMonth.format(asUtc(monday))} – ${dayMonthYear.format(asUtc(shiftDate(monday, 6)))}`

/** "2026-10" -> "Ekim 2026" */
export const formatMonth = (key: string): string => monthYear.format(asUtc(`${key}-01`))
