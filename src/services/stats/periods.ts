// Dönem anahtarları maçın tarihinden (YYYY-MM-DD) türetilir. Bu tarih CSV
// okunurken Europe/Istanbul saatine çevrilmiş takvim günüdür; bu yüzden
// burada yeniden saat dilimi çevrimi yapılmaz. Hafta pazartesi başlar.

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`)

/** Tarihin içinde bulunduğu haftanın pazartesi günü (YYYY-MM-DD) */
export const weekStart = (date: string): string => {
  const d = asUtc(date)
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM */
export const monthKey = (date: string): string => date.slice(0, 7)
