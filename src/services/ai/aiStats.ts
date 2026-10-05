import { AI_DECISIONS, isApproved, type AiDecision, type AiProvider } from '../../config/ai'
import type { AiVerdict, Pick } from '../../types'
import { tally, type Tally } from '../stats/statsEngine'

/** consensus: iki yapay zekânın aynı kararı verdiği maçlar */
export type AiSource = AiProvider | 'consensus'
export const AI_SOURCES: readonly AiSource[] = ['chatgpt', 'gemini', 'consensus']

export interface AiStats {
  /** Kaynağın onayladığı (Güçlü veya Orta) maçların önerilerindeki başarı */
  approved: Record<AiSource, Tally>
  /** Karar seviyesine göre başarı, kaynak kaynak */
  byDecision: { decision: AiDecision; tallies: Record<AiSource, Tally> }[]
  /** Kararı kaydedilmiş benzersiz maç sayısı */
  matches: Record<AiSource, number>
}

/**
 * Yapay zekâ kararlarının başarısı. Karar maç bazındadır; başarı, o maçın
 * dondurulmuş önerilerinin (kazandı / kaybetti) sonucuyla ölçülür. Bir maç
 * birden çok kategoride önerildiyse her önerisi ayrı sayılır.
 * Kararı olan ama skoru girilmemiş maçlar orana girmez. Hiç karar yoksa null.
 */
export function buildAiStats(picks: Pick[], verdicts: AiVerdict[]): AiStats | null {
  if (verdicts.length === 0) return null

  // kaynak -> maç -> karar
  const decisions: Record<AiSource, Map<string, AiDecision>> = {
    chatgpt: new Map(),
    gemini: new Map(),
    consensus: new Map(),
  }
  for (const v of verdicts) decisions[v.provider].set(v.matchId, v.decision)
  for (const [matchId, decision] of decisions.chatgpt) {
    if (decisions.gemini.get(matchId) === decision) decisions.consensus.set(matchId, decision)
  }

  const picksWhere = (source: AiSource, keep: (decision: AiDecision) => boolean): Pick[] =>
    picks.filter((p) => {
      const decision = decisions[source].get(p.matchId)
      return decision !== undefined && keep(decision)
    })
  const perSource = <T>(make: (source: AiSource) => T) =>
    Object.fromEntries(AI_SOURCES.map((s) => [s, make(s)])) as Record<AiSource, T>

  return {
    approved: perSource((s) => tally(picksWhere(s, isApproved))),
    byDecision: AI_DECISIONS.map(({ id }) => ({
      decision: id,
      tallies: perSource((s) => tally(picksWhere(s, (d) => d === id))),
    })),
    matches: perSource((s) => decisions[s].size),
  }
}
