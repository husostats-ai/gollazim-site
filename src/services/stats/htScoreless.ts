import type { MatchResult, Pick } from '../../types'
import { LOW_SAMPLE_LIMIT } from './statsEngine'

// "İY 0.5 ÜST tutmadığında 2. yarı": İY 0.5 ÜST olarak dondurulmuş önerilerden ilk yarısı
// 0-0 biten maçlarda 2. yarıda en az 2 gol olup olmadığını sayar. Yalnızca sayımdır;
// önerileri, dondurmayı ve diğer istatistikleri etkilemez, üye paketine girmez.

export interface HtScorelessStats {
  /** Kapsamdaki maç: İY 0.5 ÜST önerilmiş, "tamamlandı" kaydedilmiş, İY ve MS skoru girilmiş */
  scored: number
  /** Kapsam dışı öneri: maç tamamlanmadı ya da İY / MS skoru yok */
  excluded: number
  /** Kapsamdaki maçlardan ilk yarısı 0-0 bitenler (N) */
  scoreless: number
  /** N içinde 2Y 1.5 ÜST olanlar (maç sonu toplamı en az 2) */
  over: number
  /** N içinde 2Y 1.5 ÜST olmayanlar (maç sonu toplamı 0 ya da 1) */
  under: number
  /** over / scoreless, yüzde, bir ondalık; N = 0 ise null */
  rate: number | null
  lowSample: boolean
}

/**
 * İlk yarı 0-0 olduğu için 2. yarı golü maç sonu toplamına eşittir: 2Y 1.5 ÜST = toplam >= 2.
 * Öneri maç + kategori başına tektir; bu yüzden öneri sayısı maç sayısıdır.
 */
export function buildHtScorelessStats(picks: Pick[], results: MatchResult[]): HtScorelessStats {
  const byMatch = new Map(results.map((r) => [r.matchId, r]))
  let scored = 0
  let excluded = 0
  let scoreless = 0
  let over = 0
  for (const pick of picks) {
    if (pick.categoryId !== 'ht05') continue
    const r = byMatch.get(pick.matchId)
    if (!r || r.status !== 'completed' || r.htHome === null || r.htAway === null || r.ftHome === null || r.ftAway === null) {
      excluded++
      continue
    }
    scored++
    if (r.htHome + r.htAway > 0) continue
    scoreless++
    if (r.ftHome + r.ftAway >= 2) over++
  }
  return {
    scored,
    excluded,
    scoreless,
    over,
    under: scoreless - over,
    rate: scoreless === 0 ? null : Math.round((over / scoreless) * 1000) / 10,
    lowSample: scoreless < LOW_SAMPLE_LIMIT,
  }
}
