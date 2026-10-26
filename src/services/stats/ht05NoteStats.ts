import { HT05_NOTE_SINCE, showsHt05Note, type CategoryId } from '../../config/categories'
import type { MatchResult, Pick } from '../../types'
import { formatDay, formatRate } from '../../utils/format'
import { LOW_SAMPLE_LIMIT } from './statsEngine'

// "İY 0.5 ÜST tutmadığında 2. yarı" bloğunun İY 0.5 ÜST (*) notu satırları. Yalnızca sayımdır: önerileri, dondurmayı,
// diğer istatistikleri ve üye paketini (buildHtScorelessStats) etkilemez. (*) koşulu kartlardaki notla aynıdır
// (showsHt05Note) ve maçın TÜM dondurulmuş önerilerinden hesaplanır: seçili kapsam (Paylaşılan, tarih) yalnızca
// hangi İY 0.5 ÜST önerilerinin sayılacağını belirler.

export interface Ht05GroupStats {
  /** Kapsamdaki maç: İY 0.5 ÜST önerilmiş, "tamamlandı" kaydedilmiş, İY ve MS skoru girilmiş */
  scored: number
  /** Kapsam dışı öneri: maç tamamlanmadı ya da İY / MS skoru yok */
  excluded: number
  /** İlk yarısı golle biten (İY 0.5 ÜST tuttu): scored − scoreless */
  htWon: number
  /** İlk yarısı 0-0 biten (N) */
  scoreless: number
  /** N içinde 2. yarıda en az 2 gol (2Y 1.5 ÜST) */
  over: number
  /** N içinde 2. yarıda en az 3 gol (maç 2.5 ÜST) */
  three: number
}

export type Ht05GroupKey = 'star' | 'nonStarAll' | 'nonStarOver25' | 'starSince'

export const HT05_GROUP_LABELS: Record<Ht05GroupKey, string> = {
  star: '(*) maçları',
  nonStarAll: '(*) olmayan tüm İY önerili maçlar',
  nonStarOver25: '(*) olmayan, İY + 2.5 ÜST önerili maçlar',
  starSince: `(*) maçları · ${formatDay(HT05_NOTE_SINCE)} ve sonrası (uyarı yayındayken)`,
}
export const HT05_GROUP_KEYS = Object.keys(HT05_GROUP_LABELS) as Ht05GroupKey[]

/** "k/n · %x" ya da n < LOW_SAMPLE_LIMIT ise "k/n · az veri" (yüzde yazılmaz); n = 0 ise "—" */
export function ht05Share(k: number, n: number): string {
  if (n === 0) return '—'
  if (n < LOW_SAMPLE_LIMIT) return `${k}/${n} · az veri`
  return `${k}/${n} · ${formatRate(Math.round((k / n) * 1000) / 10)}`
}

export const HT05_NOTE_STATS_NOTE =
  'Geçmiş maçların sayımıdır; genel oran gibi okunmamalı, yalnızca önerilen maçların sonuçlarıdır. (*) koşulu: maçın dondurulmuş önerilerinde İLK YARI 0.5 ÜST, 2.5 ÜST ve 2. YARI 0.5 ÜST birlikte (kartlardaki notla aynı kural). Aynı maçın önerileri ve 1. / 2. yarı sonuçları birbirinden bağımsız değildir.'

/** Kapsamdaki İY 0.5 ÜST önerilerinden keep'in kabul ettiklerinin sayımı; keep verilmezse tümü (üstteki blokla aynı kapsam) */
export function countHt05(scopedPicks: Pick[], results: MatchResult[], keep: (p: Pick) => boolean = () => true): Ht05GroupStats {
  const byMatch = new Map(results.map((r) => [r.matchId, r]))
  const g: Ht05GroupStats = { scored: 0, excluded: 0, htWon: 0, scoreless: 0, over: 0, three: 0 }
  for (const p of scopedPicks) {
    if (p.categoryId !== 'ht05' || !keep(p)) continue
    const r = byMatch.get(p.matchId)
    if (!r || r.status !== 'completed' || r.htHome === null || r.htAway === null || r.ftHome === null || r.ftAway === null) {
      g.excluded++
      continue
    }
    g.scored++
    if (r.htHome + r.htAway > 0) {
      g.htWon++
      continue
    }
    // İlk yarı 0-0: 2. yarı golü maç sonu toplamıdır.
    g.scoreless++
    if (r.ftHome + r.ftAway >= 2) g.over++
    if (r.ftHome + r.ftAway >= 3) g.three++
  }
  return g
}

export function buildHt05NoteStats(scopedPicks: Pick[], allPicks: Pick[], results: MatchResult[]): Record<Ht05GroupKey, Ht05GroupStats> {
  const listed = new Map<string, CategoryId[]>()
  for (const p of allPicks) listed.set(p.matchId, [...(listed.get(p.matchId) ?? []), p.categoryId])
  const star = (p: Pick) => showsHt05Note('ht05', listed.get(p.matchId) ?? [])
  const group = (keep: (p: Pick) => boolean) => countHt05(scopedPicks, results, keep)
  return {
    star: group(star),
    nonStarAll: group((p) => !star(p)),
    nonStarOver25: group((p) => !star(p) && (listed.get(p.matchId) ?? []).includes('over25')),
    starSince: group((p) => star(p) && p.date >= HT05_NOTE_SINCE),
  }
}
