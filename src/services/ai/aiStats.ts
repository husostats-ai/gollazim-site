import { AI_CATEGORY_IDS, AI_DECISIONS, AI_PROVIDERS, isApproved, type AiDecision, type AiProvider } from '../../config/ai'
import type { CategoryId } from '../../config/categories'
import { isMainCategory } from '../../config/mainCategories'
import type { AiVerdict, Match, Pick } from '../../types'
import { kickoffOf } from '../highlights/highlights'
import { tally, type Tally } from '../stats/statsEngine'
import { majorityDecision } from './consensus'
import { categoryVotes, legacyVotes, type ProviderVote } from './verdicts'

/** majority: karar veren yapay zekâların çoğunluğunun aynı kararı verdiği durum */
export type AiSource = AiProvider | 'majority'
export const AI_SOURCES: readonly AiSource[] = [...AI_PROVIDERS.map((p) => p.id), 'majority']

export interface AiStats {
  /** Kaynağın onayladığı (Güçlü veya Orta) önerilerdeki başarı */
  approved: Record<AiSource, Tally>
  /** Karar seviyesine göre başarı, kaynak kaynak */
  byDecision: { decision: AiDecision; tallies: Record<AiSource, Tally> }[]
  /** Kararı kaydedilmiş benzersiz birim sayısı: kategori bazlı dökümde (maç, kategori) çifti, eski dökümde maç */
  units: Record<AiSource, number>
}

/** Kaynak -> birim anahtarı -> karar eşlemesinden dökümü kurar; keyOf önerinin hangi birime ait olduğunu söyler */
function statsFrom(picks: Pick[], decisions: Record<AiSource, Map<string, AiDecision>>, keyOf: (pick: Pick) => string): AiStats {
  const picksWhere = (source: AiSource, keep: (decision: AiDecision) => boolean): Pick[] =>
    picks.filter((p) => {
      const decision = decisions[source].get(keyOf(p))
      return decision !== undefined && keep(decision)
    })
  const perSource = <T>(make: (source: AiSource) => T) => Object.fromEntries(AI_SOURCES.map((s) => [s, make(s)])) as Record<AiSource, T>
  return {
    approved: perSource((s) => tally(picksWhere(s, isApproved))),
    byDecision: AI_DECISIONS.map(({ id }) => ({
      decision: id,
      tallies: perSource((s) => tally(picksWhere(s, (d) => d === id))),
    })),
    units: perSource((s) => decisions[s].size),
  }
}

const emptyMaps = () => Object.fromEntries(AI_SOURCES.map((s) => [s, new Map<string, AiDecision>()])) as Record<AiSource, Map<string, AiDecision>>

const byMatch = (verdicts: readonly AiVerdict[]): Map<string, AiVerdict[]> => {
  const known = verdicts.filter((v) => AI_PROVIDERS.some((p) => p.id === v.provider))
  const groups = new Map<string, AiVerdict[]>()
  for (const v of known) groups.set(v.matchId, [...(groups.get(v.matchId) ?? []), v])
  return groups
}

/** İstatistik sayfasında ölçülen kategori bazlı kararlar: karar alınan kategorilerden ana kategoriler */
export const MAIN_AI_CATEGORY_IDS: readonly CategoryId[] = AI_CATEGORY_IDS.filter(isMainCategory)

const pairKey = (matchId: string, categoryId: CategoryId): string => `${matchId}|${categoryId}`

/**
 * Kategori bazlı kararları kaynak kaynak toplar; keep verilirse yalnızca onun kabul ettiği kararlar sayılır.
 * categories: hangi kategorilerin kararları toplanır (varsayılan: karar alınan tüm kategoriler).
 */
function categoryDecisions(
  verdicts: AiVerdict[],
  keep?: (matchId: string, vote: ProviderVote) => boolean,
  categories: readonly CategoryId[] = AI_CATEGORY_IDS,
): Record<AiSource, Map<string, AiDecision>> {
  const decisions = emptyMaps()
  for (const [matchId, own] of byMatch(verdicts)) {
    for (const categoryId of categories) {
      const votes = categoryVotes(own, categoryId).filter((vote) => !keep || keep(matchId, vote))
      for (const vote of votes) decisions[vote.provider].set(pairKey(matchId, categoryId), vote.decision)
      const majority = majorityDecision(votes)
      if (majority) decisions.majority.set(pairKey(matchId, categoryId), majority)
    }
  }
  return decisions
}

const hasAny = (decisions: Record<AiSource, Map<string, AiDecision>>): boolean => AI_PROVIDERS.some((p) => decisions[p.id].size > 0)

/**
 * KATEGORİ BAZLI kararların başarısı. Karar (maç, kategori) çiftine aittir ve yalnızca o maçın
 * o kategorideki dondurulmuş önerisinin (kazandı / kaybetti) sonucuyla ölçülür; maçın başka
 * kategorilerdeki önerileri bu dökümlere girmez. Çoğunluk, o kategoride karar veren yapay
 * zekâlar üzerinden hesaplanır (ortalama alınmaz). Hiç kategori kararı yoksa null.
 * Eski maç geneli kararlar bu döküme GİRMEZ (bkz. buildLegacyAiStats).
 */
export function buildCategoryAiStats(picks: Pick[], verdicts: AiVerdict[]): AiStats | null {
  const decisions = categoryDecisions(verdicts)
  if (!hasAny(decisions)) return null
  return statsFrom(picks, decisions, (p) => pairKey(p.matchId, p.categoryId))
}

/**
 * İstatistik sayfasının yüklemesi gereken maç kayıtları: önerisi, girilmiş skoru ya da yapay zekâ kararı olanlar.
 * Skoru henüz girilmemiş maçın önerisi dondurulmamıştır; kaydı yüklenmezse başlama saati bilinemez ve
 * maç öncesi kaydedilmiş kararı "saati bilinmeyen" sayılırdı.
 */
export const statsMatchIds = (picks: readonly { matchId: string }[], results: readonly { matchId: string }[], verdicts: readonly { matchId: string }[]): string[] => [
  ...new Set([...picks, ...results, ...verdicts].map((r) => r.matchId)),
]

/** İstatistik sayfasındaki kategori bazlı kart: yalnızca maç başlamadan önce kaydedilmiş kararlar */
export interface PreMatchAiStats extends AiStats {
  /** En az bir yapay zekânın kararı olan tüm öneriler (onay ya da eleme fark etmez); her öneri bir kez */
  all: Tally
  /** Kaynağın karar verdiği tüm öneriler: onay satırındaki farkın karşılaştırma tabanı */
  judged: Record<AiSource, Tally>
  /** Kaynağın onaylamadığı (Zayıf veya Eleme) önerilerdeki başarı */
  rejected: Record<AiSource, Tally>
  /** Ölçüme girmeyen karar sayısı (yapay zekâ + maç + kategori): maç başladıktan sonra kaydedilen / başlama saati bilinmeyen */
  excluded: { late: number; noKickoff: number }
}

/**
 * buildCategoryAiStats ile aynı hesap; tek fark: karar maç başlamadan ÖNCE kaydedilmiş olmalıdır.
 * Maç kaydı ya da başlama saati yoksa, kayıt anı okunamıyorsa karar ölçüme girmez (sayısı excluded'da).
 * Çoğunluk yalnızca ölçüme giren kararlardan hesaplanır. Hiç kategori kararı yoksa null.
 * categories verilirse yalnızca o kategorilerin kararları ölçülür ve sayılır (istatistik sayfası: MAIN_AI_CATEGORY_IDS).
 */
export function buildPreMatchAiStats(
  picks: Pick[],
  verdicts: AiVerdict[],
  matches: readonly Match[],
  categories: readonly CategoryId[] = AI_CATEGORY_IDS,
): PreMatchAiStats | null {
  if (!hasAny(categoryDecisions(verdicts, undefined, categories))) return null
  const kickoffs = new Map(matches.map((m) => [m.id, kickoffOf(m)]))
  const excluded = { late: 0, noKickoff: 0 }
  const decisions = categoryDecisions(verdicts, (matchId, vote) => {
    const kickoff = kickoffs.get(matchId)
    if (!kickoff) {
      excluded.noKickoff++
      return false
    }
    const savedAt = Date.parse(vote.savedAt)
    if (Number.isNaN(savedAt) || savedAt >= kickoff.getTime()) {
      excluded.late++
      return false
    }
    return true
  }, categories)
  const keyOf = (p: Pick) => pairKey(p.matchId, p.categoryId)
  const where = (source: AiSource, keep: (decision: AiDecision) => boolean): Pick[] =>
    picks.filter((p) => {
      const decision = decisions[source].get(keyOf(p))
      return decision !== undefined && keep(decision)
    })
  const perSource = (keep: (decision: AiDecision) => boolean) => Object.fromEntries(AI_SOURCES.map((s) => [s, tally(where(s, keep))])) as Record<AiSource, Tally>
  return {
    ...statsFrom(picks, decisions, keyOf),
    all: tally(picks.filter((p) => AI_PROVIDERS.some((provider) => decisions[provider.id].has(keyOf(p))))),
    judged: perSource(() => true),
    rejected: perSource((d) => !isApproved(d)),
    excluded,
  }
}

/** Onay satırındaki fark: onayladıklarındaki başarı − karar verdiği tüm önerilerdeki başarı (yüzde puan); biri yoksa null */
export const approvalEdge = (approved: Tally, judged: Tally): number | null =>
  approved.rate === null || judged.rate === null ? null : Math.round((approved.rate - judged.rate) * 10) / 10

/**
 * ESKİ (maç geneli) kararların başarısı: kategori bazlı karara geçilmeden önceki hesabın aynısı.
 * Karar maçın tümüne aittir; o maçın bütün dondurulmuş önerileri sayılır. Kategori bazlı kararlar
 * bu döküme GİRMEZ. Hiç eski karar yoksa null.
 */
export function buildLegacyAiStats(picks: Pick[], verdicts: AiVerdict[]): AiStats | null {
  const decisions = emptyMaps()
  for (const [matchId, own] of byMatch(verdicts)) {
    const votes = legacyVotes(own)
    for (const vote of votes) decisions[vote.provider].set(matchId, vote.decision)
    const majority = majorityDecision(votes)
    if (majority) decisions.majority.set(matchId, majority)
  }
  if (AI_PROVIDERS.every((p) => decisions[p.id].size === 0)) return null
  return statsFrom(picks, decisions, (p) => p.matchId)
}
