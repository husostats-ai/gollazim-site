import type { CategoryId } from '../../config/categories'
import type { MatchResult, Pick } from '../../types'
import { tally, type Tally } from './statsEngine'

/** Günlük başarı görselindeki kategoriler, görseldeki sırayla */
export const DAILY_CATEGORY_IDS = ['over25', 'ht05', 'sh05', 'btts', 'over25btts'] as const satisfies readonly CategoryId[]

export type DailyCategoryId = (typeof DAILY_CATEGORY_IDS)[number]

export interface DailyRow {
  categoryId: DailyCategoryId
  tally: Tally
}

export interface DailySummary {
  /** YYYY-MM-DD */
  date: string
  /** Her zaman 5 satır; o gün önerisi olmayan kategorinin sayımı sıfırdır */
  rows: DailyRow[]
  /** Beş kategorinin tüm önerileri birlikte: toplam kazanan / toplam sonuçlanan */
  overall: Tally
}

const isDaily = (id: CategoryId): id is DailyCategoryId => (DAILY_CATEGORY_IDS as readonly CategoryId[]).includes(id)

/** Günün, görseldeki beş kategoriye ait dondurulmuş önerileri */
const dailyPicks = (picks: Pick[], date: string): Pick[] => picks.filter((p) => p.date === date && isDaily(p.categoryId))

/**
 * Bir günün özetini istatistik motorunun sayımıyla (tally) üretir: yalnızca
 * kazandı + kaybetti orana girer. Genel başarı kategori yüzdelerinin
 * ortalaması değil, önerilerin toplamı üzerinden hesaplanır.
 */
export function buildDailySummary(picks: Pick[], date: string): DailySummary {
  const ofDay = dailyPicks(picks, date)
  return {
    date,
    rows: DAILY_CATEGORY_IDS.map((categoryId) => ({
      categoryId,
      tally: tally(ofDay.filter((p) => p.categoryId === categoryId)),
    })),
    overall: tally(ofDay),
  }
}

/**
 * Görseldeki tam sayı yüzde. Bir ondalıklı orandan (tally.rate) değil doğrudan
 * sayımdan yuvarlanır ki iki kez yuvarlama olmasın; sonuçlanmış öneri yoksa null.
 */
export const wholePercent = (t: Tally): number | null => (t.decided === 0 ? null : Math.round((t.won / t.decided) * 100))

/** Beş kategoriden birinde sonuçlanmış (kazandı/kaybetti) önerisi olan en son gün; yoksa null */
export function latestDecidedDate(picks: Pick[]): string | null {
  let latest: string | null = null
  for (const p of picks) {
    if (!isDaily(p.categoryId) || (p.outcome !== 'won' && p.outcome !== 'lost')) continue
    if (latest === null || p.date > latest) latest = p.date
  }
  return latest
}

/**
 * Günün henüz sonuçlanmamış maç sayısı: beş kategoriden birinde önerilen
 * (dondurulmuş ya da şu an listede olan) ve skoru girilmemiş / "bekliyor"
 * durumundaki benzersiz maçlar. Ertelenen ve iptal edilen maçlar sayılmaz.
 */
export function countUnsettledMatches(
  picks: Pick[],
  date: string,
  /** Günün, beş kategoride şu an önerilen maçlarının kimlikleri */
  recommendedMatchIds: string[],
  results: Record<string, MatchResult | undefined>,
): number {
  const candidates = new Set([...dailyPicks(picks, date).map((p) => p.matchId), ...recommendedMatchIds])
  return [...candidates].filter((id) => (results[id]?.status ?? 'pending') === 'pending').length
}
