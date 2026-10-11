import type { LeagueTable, LeagueTableRow, LeagueTableSnapshot } from '../../types'
import { canonicalRow } from './matching'

// Lig tablosu yapıştırma geçmişi. Güncel tablo her yapıştırmada üzerine yazılır; burada her
// yapıştırmanın kopyası kalır ki sonradan "o maçtan önce tabloda ne yazıyordu" sorulabilsin.
// Yalnızca veri toplar: analize, dondurmaya, prompt'a ve üye paketine girmez.

export const snapshotId = (league: string, pastedAt: string): string => `${league}|${pastedAt}`

/** İki tablonun içeriği aynı mı (alan sırası ve tanınmayan alanlar dikkate alınmaz) */
export const sameRows = (a: LeagueTableRow[], b: LeagueTableRow[]): boolean =>
  JSON.stringify(a.map(canonicalRow)) === JSON.stringify(b.map(canonicalRow))

const byTime = (a: LeagueTableSnapshot, b: LeagueTableSnapshot): number => Date.parse(a.pastedAt) - Date.parse(b.pastedAt)

/**
 * Kaydedilen tablo için geçmişe yazılacak kayıt. İçerik ligin son görüntüsüyle aynıysa yeni
 * kayıt açılmaz: o görüntünün "son görülme" anı güncellenir.
 */
export function nextSnapshot(history: LeagueTableSnapshot[], table: LeagueTable): LeagueTableSnapshot {
  const last = history.filter((s) => s.league === table.league).sort(byTime).at(-1)
  if (last && sameRows(last.rows, table.rows)) return { ...last, lastSeenAt: table.pastedAt }
  return { id: snapshotId(table.league, table.pastedAt), league: table.league, pastedAt: table.pastedAt, rows: table.rows }
}

/** Geçmişi olmayan tablolar için ilk görüntüler (şema yükseltmesi ve geçmişsiz eski yedekler) */
export function seedSnapshots(tables: LeagueTable[], snapshots: LeagueTableSnapshot[]): LeagueTableSnapshot[] {
  const known = new Set(snapshots.map((s) => s.league))
  return tables.filter((t) => !known.has(t.league)).map((t) => nextSnapshot([], t))
}

/**
 * Verilen andan (ör. maçın başlama saati) ÖNCE yapıştırılmış son görüntü; yoksa null.
 * O andan sonra yapıştırılan tablo maçın sonucunu içerebileceği için hiç döndürülmez.
 */
export function snapshotAt(snapshots: LeagueTableSnapshot[], league: string, at: Date): LeagueTableSnapshot | null {
  const earlier = snapshots.filter((s) => s.league === league && Date.parse(s.pastedAt) < at.getTime())
  return earlier.sort(byTime).at(-1) ?? null
}

/** Yedekten gelen geçmişi doğrular; bozuk kayıt ve satırlar atılır. */
export function normalizeSnapshots(value: unknown): LeagueTableSnapshot[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, LeagueTableSnapshot>()
  for (const snapshot of value as Partial<LeagueTableSnapshot>[]) {
    if (typeof snapshot !== 'object' || snapshot === null) continue
    const { league, pastedAt, lastSeenAt, rows } = snapshot
    if (typeof league !== 'string' || typeof pastedAt !== 'string' || Number.isNaN(Date.parse(pastedAt)) || !Array.isArray(rows)) continue
    const id = snapshotId(league, pastedAt)
    byId.set(id, {
      id,
      league,
      pastedAt,
      ...(typeof lastSeenAt === 'string' && { lastSeenAt }),
      rows: rows.map(canonicalRow).filter((r): r is LeagueTableRow => r !== null),
    })
  }
  return [...byId.values()]
}
