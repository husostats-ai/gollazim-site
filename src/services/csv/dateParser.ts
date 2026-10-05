import { toAppDateTime } from '../../utils/date'
import { parseNumber } from './values'

export interface MatchDateTime {
  date: string
  time?: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const isValidYmd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** "Oct 05 2026 - 9:00am" (GMT) biçimi */
function parseGmtText(text: string): Date | null {
  const m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})(?:\s*-?\s*(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i.exec(text.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  let hour = m[4] ? Number(m[4]) : 12
  const meridiem = m[6]?.toLowerCase()
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (!isValidYmd(Number(m[3]), month + 1, Number(m[2]))) return null
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, m[5] ? Number(m[5]) : 0))
}

/** "2026-10-05" veya "05.10.2026" / "05/10/2026" (gün önce) biçimleri; saat dilimi çevrilmez */
function parsePlainDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text.trim())
  const tr = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text.trim())
  const parts = iso ? [iso[1], iso[2], iso[3]] : tr ? [tr[3], tr[2], tr[1]] : null
  if (!parts) return null
  const [y, mo, d] = parts.map(Number)
  return isValidYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
}

const parseClock = (text: string | null): string | undefined => {
  const m = text ? /^(\d{1,2})[:.](\d{2})/.exec(text.trim()) : null
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(Number(m[1]))}:${m[2]}` : undefined
}

/**
 * Önce unix zaman damgası, sonra GMT metni Türkiye saatine çevrilir;
 * ikisi de yoksa düz tarih (ve varsa saat kolonu) olduğu gibi alınır.
 */
export function parseMatchDate(input: {
  dateUnix?: string
  dateText?: string
  time?: string
}): MatchDateTime | null {
  const unix = parseNumber(input.dateUnix)
  if (unix !== null && unix > 0) {
    // 10 haneden uzunsa milisaniye kabul edilir
    return toAppDateTime(new Date(unix > 1e11 ? unix : unix * 1000))
  }
  if (input.dateText) {
    const gmt = parseGmtText(input.dateText)
    if (gmt) return toAppDateTime(gmt)
    const date = parsePlainDate(input.dateText)
    if (date) return { date, time: parseClock(input.time ?? null) }
  }
  return null
}
