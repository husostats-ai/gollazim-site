import { AI_DECISIONS, AI_PROVIDERS, isApproved, SUMMARY_AI_PROVIDERS, type AiDecision, type AiProvider } from '../../config/ai'
import type { AiVerdict, Pick } from '../../types'
import { tally, type Tally } from '../stats/statsEngine'
import { majorityDecision } from './consensus'

/** majority: cevap veren yapay zekâların çoğunluğunun aynı kararı verdiği maçlar */
export type AiSource = AiProvider | 'majority'
export const AI_SOURCES: readonly AiSource[] = [...AI_PROVIDERS.map((p) => p.id), 'majority']

/** "Analiz için özet"in sabit kaynakları. consensus: ChatGPT ve Gemini'nin aynı kararı verdiği maçlar */
export type SummaryAiSource = 'chatgpt' | 'gemini' | 'consensus'
export const SUMMARY_AI_SOURCES: readonly SummaryAiSource[] = ['chatgpt', 'gemini', 'consensus']

export interface AiStats<S extends string = AiSource> {
  /** Kaynağın onayladığı (Güçlü veya Orta) maçların önerilerindeki başarı */
  approved: Record<S, Tally>
  /** Karar seviyesine göre başarı, kaynak kaynak */
  byDecision: { decision: AiDecision; tallies: Record<S, Tally> }[]
  /** Kararı kaydedilmiş benzersiz maç sayısı */
  matches: Record<S, number>
}

/** Kaynak -> maç -> karar eşlemesinden dökümü kurar */
function statsFrom<S extends string>(picks: Pick[], sources: readonly S[], decisions: Record<S, Map<string, AiDecision>>): AiStats<S> {
  const picksWhere = (source: S, keep: (decision: AiDecision) => boolean): Pick[] =>
    picks.filter((p) => {
      const decision = decisions[source].get(p.matchId)
      return decision !== undefined && keep(decision)
    })
  const perSource = <T>(make: (source: S) => T) => Object.fromEntries(sources.map((s) => [s, make(s)])) as Record<S, T>
  return {
    approved: perSource((s) => tally(picksWhere(s, isApproved))),
    byDecision: AI_DECISIONS.map(({ id }) => ({
      decision: id,
      tallies: perSource((s) => tally(picksWhere(s, (d) => d === id))),
    })),
    matches: perSource((s) => decisions[s].size),
  }
}

const emptyMaps = <S extends string>(sources: readonly S[]) =>
  Object.fromEntries(sources.map((s) => [s, new Map<string, AiDecision>()])) as Record<S, Map<string, AiDecision>>

const isKnownProvider = (provider: string): provider is AiProvider => AI_PROVIDERS.some((p) => p.id === provider)

/**
 * Yapay zekâ kararlarının başarısı. Karar maç bazındadır; başarı, o maçın
 * dondurulmuş önerilerinin (kazandı / kaybetti) sonucuyla ölçülür. Bir maç
 * birden çok kategoride önerildiyse her önerisi ayrı sayılır.
 * Kararı olan ama skoru girilmemiş maçlar orana girmez. Hiç karar yoksa null.
 * Çoğunluk kararı, maçta cevap veren yapay zekâlar üzerinden hesaplanır (ortalama alınmaz).
 */
export function buildAiStats(picks: Pick[], verdicts: AiVerdict[]): AiStats | null {
  const known = verdicts.filter((v) => isKnownProvider(v.provider))
  if (known.length === 0) return null
  const decisions = emptyMaps(AI_SOURCES)
  const byMatch = new Map<string, AiVerdict[]>()
  for (const v of known) {
    decisions[v.provider].set(v.matchId, v.decision)
    byMatch.set(v.matchId, [...(byMatch.get(v.matchId) ?? []).filter((o) => o.provider !== v.provider), v])
  }
  for (const [matchId, own] of byMatch) {
    const decision = majorityDecision(own)
    if (decision) decisions.majority.set(matchId, decision)
  }
  return statsFrom(picks, AI_SOURCES, decisions)
}

/**
 * "Analiz için özet"teki döküm: Claude eklenmeden önceki hesabın aynısı. Yalnızca ChatGPT ve
 * Gemini kararlarını görür; "Ortak karar" bu ikisinin aynı kararı verdiği maçlardır.
 */
export function buildSummaryAiStats(picks: Pick[], verdicts: AiVerdict[]): AiStats<SummaryAiSource> | null {
  const own = verdicts.filter((v) => SUMMARY_AI_PROVIDERS.some((p) => p.id === v.provider))
  if (own.length === 0) return null
  const decisions = emptyMaps(SUMMARY_AI_SOURCES)
  for (const v of own) decisions[v.provider as 'chatgpt' | 'gemini'].set(v.matchId, v.decision)
  for (const [matchId, decision] of decisions.chatgpt) {
    if (decisions.gemini.get(matchId) === decision) decisions.consensus.set(matchId, decision)
  }
  return statsFrom(picks, SUMMARY_AI_SOURCES, decisions)
}
