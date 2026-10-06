import type { CategoryId } from '../../config/categories'
import type { FieldKey } from '../../config/columnAliases'
import type { Match } from '../../types'
import { normalizeHeader } from '../csv/values'
import { stat } from './stat'
import type { PredictionNote } from './types'

// Piyasa yüzdesi: CSV'deki iki yönlü oranlardan (Üst/Alt, KG Var/Yok) marjdan
// arındırılmış olasılık. Yalnızca gösterilir ve kaydedilir; ana yüzdeyi, eşiği,
// yıldızı ve sıralamayı etkilemez. Oranlardan biri yoksa piyasa yüzdesi de yoktur.

/** Hazır yüzde ile piyasa yüzdesi arasındaki fark en az bu kadar puansa "piyasa çelişkisi" (Admin'den değişir) */
export const DEFAULT_MARKET_CONFLICT_LIMIT = 25
export const MARKET_CONFLICT_LIMIT_RANGE = { min: 1, max: 100 } as const

/** Oran kaynağı: eşlenmiş alan adı ya da CSV'deki ham kolon adı */
type OddsSource = { field: FieldKey } | { header: string }

const pair = (yes: string, no: string): { yes: OddsSource; no: OddsSource } => ({ yes: { header: yes }, no: { header: no } })

/** Piyasa yüzdesi hesaplanan kategoriler ve oran kolonları. Kart ve Taraf & Gol kategorileri yoktur. */
const MARKET_ODDS: Partial<Record<CategoryId, { yes: OddsSource; no: OddsSource }>> = {
  over25: { yes: { field: 'oddsOver25' }, no: { field: 'oddsUnder25' } },
  over35: pair('Odds_Over35', 'Odds_Under35'),
  over45: pair('Odds_Over45', 'Odds_Under45'),
  btts: pair('Odds_BTTS_Yes', 'Odds_BTTS_No'),
  ht05: pair('Odds_1st_Half_Over05', 'Odds_1st_Half_Under05'),
  ht15: pair('Odds_1st_Half_Over15', 'Odds_1st_Half_Under15'),
  sh05: pair('Odds_2nd_Half_Over05', 'Odds_2nd_Half_Under05'),
  corners85: pair('Odds_Corners_Over85', 'Odds_Corners_Under85'),
  corners95: pair('Odds_Corners_Over95', 'Odds_Corners_Under95'),
  corners105: pair('Odds_Corners_Over105', 'Odds_Corners_Under105'),
}

export const hasMarket = (categoryId: CategoryId): boolean => categoryId in MARKET_ODDS

export const MARKET_CATEGORY_IDS = Object.keys(MARKET_ODDS) as CategoryId[]

/** Eşlenmemiş kolonlar maç kaydında CSV'deki adıyla saklanır; ad küçük farklarla gelirse de bulunur. */
const rawStat = (match: Match, header: string): number | null => {
  let value = match.stats[header]
  if (value === undefined) {
    const wanted = normalizeHeader(header)
    const key = Object.keys(match.stats).find((k) => normalizeHeader(k) === wanted)
    if (key !== undefined) value = match.stats[key]
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const odds = (match: Match, source: OddsSource): number | null => {
  const value = 'field' in source ? stat(match, source.field) : rawStat(match, source.header)
  // Ondalık oran 1'den büyük olur; 0, 1 ve negatif değerler "veri yok" sayılır.
  return value !== null && value > 1 ? value : null
}

/**
 * İki yönlü orandan marjsız olasılık (0-1): (1/evet) / (1/evet + 1/hayır).
 * Oranlardan biri yoksa ya da geçersizse null.
 */
export function devig(yes: number | null, no: number | null): number | null {
  if (yes === null || no === null || !(yes > 1) || !(no > 1)) return null
  return 1 / yes / (1 / yes + 1 / no)
}

/** Kategorinin piyasa yüzdesi (0-100, tam sayı); kategori kapsam dışıysa ya da oran yoksa null */
export function marketPercent(match: Match, categoryId: CategoryId): number | null {
  const source = MARKET_ODDS[categoryId]
  if (!source) return null
  const probability = devig(odds(match, source.yes), odds(match, source.no))
  return probability === null ? null : Math.round(probability * 100)
}

export const isMarketConflict = (percent: number, market: number, limit: number): boolean => Math.abs(percent - market) >= limit

/** Bir önerinin piyasa bilgisi; percent null ise oran yoktur ve çelişki sayılmaz */
export interface MarketInfo {
  percent: number | null
  conflict: boolean
}

/** Kategori kapsam dışıysa undefined */
export function marketInfo(match: Match, categoryId: CategoryId, percent: number, limit: number): MarketInfo | undefined {
  if (!hasMarket(categoryId)) return undefined
  const market = marketPercent(match, categoryId)
  return { percent: market, conflict: market !== null && isMarketConflict(percent, market, limit) }
}

export const MARKET_CONFLICT_LABEL = 'Piyasa çelişkisi'
export const NO_ODDS_LABEL = 'Oran yok'

/** Kartta gösterilen piyasa rozetleri: çelişki ya da "oran yok" */
export function marketNotes(percent: number, market: MarketInfo | undefined, limit: number): PredictionNote[] {
  if (!market) return []
  if (market.percent === null) {
    return [{ kind: 'no-odds', label: NO_ODDS_LABEL, title: 'CSV’de bu kategori için iki yönlü oran yok; piyasa yüzdesi hesaplanmadı.' }]
  }
  if (!market.conflict) return []
  return [
    {
      kind: 'market-conflict',
      label: MARKET_CONFLICT_LABEL,
      title: `Hazır yüzde %${percent}, piyasa %${market.percent}: fark en az ${limit} puan.`,
    },
  ]
}

/** Ayarlardan gelen değeri geçerli bir sınıra çevirir; geçersizse varsayılan */
export function normalizeMarketConflictLimit(value: unknown): number {
  const { min, max } = MARKET_CONFLICT_LIMIT_RANGE
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : DEFAULT_MARKET_CONFLICT_LIMIT
}
