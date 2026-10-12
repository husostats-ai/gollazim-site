import { CATEGORIES, type CategoryId } from '../../config/categories'
import type { Pick } from '../../types'
import { tally, type Tally } from './statsEngine'

// Önerinin eşiği ne kadar aştığına göre başarı. Eşik üstü puan = dondurma anındaki hazır
// yüzde − dondurma anındaki eşik; ikisi de öneri kaydındadır, güncel eşik kullanılmaz.
// Yalnızca okur; eşik önerisi üretmez.

/** Eşik üstü puan bantları: alt sınır dahil, üst sınır hariç */
export const MARGIN_BANDS = [
  { from: 0, to: 5, label: '+0–5' },
  { from: 5, to: 10, label: '+5–10' },
  { from: 10, to: 15, label: '+10–15' },
  { from: 15, to: 25, label: '+15–25' },
  { from: 25, to: Infinity, label: '+25 ve üstü' },
] as const

/** "Eşik bu kadar puan yüksek olsaydı" satırının adımları */
export const RAISED_STEPS = [5, 10] as const

export const marginOf = (pick: Pick): number => pick.percent - pick.threshold

export interface MarginRow {
  key: CategoryId | 'all'
  /** Bu satırdaki önerilerin kayıtlı eşikleri, küçükten büyüğe (çoğunlukla tek değer); 'all' satırında boş */
  thresholds: number[]
  /** MARGIN_BANDS sırasıyla */
  bands: Tally[]
}

export interface MarginStats {
  /** Kayıt defterindeki sırayla, önerisi olan kategoriler; sonda 'all' */
  rows: MarginRow[]
  /** Eşik N puan yüksek olsaydı listede kalacak önerilerin (eşik üstü puan ≥ N) başarısı, tüm kategoriler */
  raised: { step: number; tally: Tally }[]
  /** Yüzdesi kayıtlı eşiğin altında olan (beklenmeyen) öneri sayısı; tabloya girmez */
  below: number
  /** "Tüm kategoriler" satırındaki sonuçlanmış önerilerin benzersiz maç sayısı */
  decidedMatches: number
}

/** Eşik üstü puana göre başarı; öneri yoksa rows boştur. */
export function buildMarginStats(picks: Pick[]): MarginStats {
  const valid = picks.filter((p) => marginOf(p) >= 0)
  const bandsOf = (list: Pick[]): Tally[] => MARGIN_BANDS.map((band) => tally(list.filter((p) => marginOf(p) >= band.from && marginOf(p) < band.to)))
  const rows: MarginRow[] = CATEGORIES.map((c) => c.id)
    .filter((id) => valid.some((p) => p.categoryId === id))
    .map((id) => {
      const list = valid.filter((p) => p.categoryId === id)
      return { key: id, thresholds: [...new Set(list.map((p) => p.threshold))].sort((a, b) => a - b), bands: bandsOf(list) }
    })
  return {
    rows: rows.length === 0 ? [] : [...rows, { key: 'all', thresholds: [], bands: bandsOf(valid) }],
    raised: RAISED_STEPS.map((step) => ({ step, tally: tally(valid.filter((p) => marginOf(p) >= step)) })),
    below: picks.length - valid.length,
    decidedMatches: new Set(valid.filter((p) => p.outcome === 'won' || p.outcome === 'lost').map((p) => p.matchId)).size,
  }
}
