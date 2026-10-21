import type { FieldKey } from '../../config/columnAliases'
import type { Match, OddsHistoryEntry, OddsKey } from '../../types'
import { rawStat } from '../analysis/market'
import { stat } from '../analysis/stat'

// Aynı maç CSV ile yeniden yüklenince önceki oranların kısa geçmişi. Yalnızca sonradan ölçüm içindir
// (oran hareketi): analize, üye paketine, görsellere ve AI prompt'una girmez. Maç kaydının stats alanı
// her yüklemede yenisiyle değiştiği için eski oranlar başka yerde kalmaz.

/** Maç başına tutulan en fazla kayıt (en eskiler düşer) */
export const ODDS_HISTORY_LIMIT = 3

/** Kısa ad -> CSV alanı (eşlenmiş alan ya da ham başlık) */
const ODDS: Record<OddsKey, { field: FieldKey } | { header: string }> = {
  home: { field: 'oddsHome' },
  draw: { field: 'oddsDraw' },
  away: { field: 'oddsAway' },
  over25: { field: 'oddsOver25' },
  under25: { field: 'oddsUnder25' },
  bttsYes: { header: 'Odds_BTTS_Yes' },
  bttsNo: { header: 'Odds_BTTS_No' },
  ht05Over: { header: 'Odds_1st_Half_Over05' },
  ht05Under: { header: 'Odds_1st_Half_Under05' },
}

/** Maçın geçmişi tutulan oranları; geçersiz (≤ 1) ya da eksik oran null */
export function oddsOf(match: Match): Record<OddsKey, number | null> {
  return Object.fromEntries(
    (Object.entries(ODDS) as [OddsKey, { field: FieldKey } | { header: string }][]).map(([key, source]) => {
      const value = 'field' in source ? stat(match, source.field) : rawStat(match, source.header)
      return [key, value !== null && value > 1 ? value : null]
    }),
  ) as Record<OddsKey, number | null>
}

/**
 * Yeniden yüklenen maçın oran geçmişi. Oranlar değiştiyse önceki oranlar (önceki yüklemenin anıyla)
 * sona eklenir ve son ODDS_HISTORY_LIMIT kayıt tutulur; değişmediyse ya da önceki kayıtta hiç oran
 * yoksa mevcut geçmiş olduğu gibi kalır. Geçmiş boşsa undefined.
 */
export function nextOddsHistory(previous: Match, incoming: Match, previousUploadedAt: string | null): OddsHistoryEntry[] | undefined {
  const before = oddsOf(previous)
  const after = oddsOf(incoming)
  const history = previous.oddsHistory ?? []
  const changed = (Object.keys(ODDS) as OddsKey[]).some((key) => before[key] !== after[key])
  const any = Object.values(before).some((value) => value !== null)
  const next = changed && any ? [...history, { at: previousUploadedAt, odds: before }].slice(-ODDS_HISTORY_LIMIT) : history
  return next.length > 0 ? next : undefined
}
