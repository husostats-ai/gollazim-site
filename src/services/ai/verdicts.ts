import { AI_PROVIDERS, type AiDecision, type AiProvider } from '../../config/ai'
import type { CategoryId } from '../../config/categories'
import type { AiVerdict } from '../../types'

// Bir maçın yapay zekâ cevaplarını okumanın ortak yolları. Kararlar kategori bazındadır;
// kategori bazlı karara geçilmeden önceki "maç geneli" kararlar ayrı tutulur ve ikisi karıştırılmaz.

export interface ProviderVote {
  provider: AiProvider
  decision: AiDecision
  /** Cevabın kaydedildiği an (ISO) */
  savedAt: string
}

/** Maçın cevapları, AI_PROVIDERS sırasıyla (her sağlayıcıdan en fazla bir tane) */
export const orderedVerdicts = (verdicts: readonly AiVerdict[]): AiVerdict[] =>
  AI_PROVIDERS.flatMap((p) => {
    const found = verdicts.find((v) => v.provider === p.id)
    return found ? [found] : []
  })

/** Maçın bir kategorideki kararları: yalnızca o kategoriye karar vermiş yapay zekâlar, sabit sırayla */
export const categoryVotes = (verdicts: readonly AiVerdict[], categoryId: CategoryId): ProviderVote[] =>
  orderedVerdicts(verdicts).flatMap((v) => {
    const decision = v.byCategory?.[categoryId]
    return decision ? [{ provider: v.provider, decision, savedAt: v.savedAt }] : []
  })

/** Maçın ESKİ (maç geneli) kararları, sabit sırayla */
export const legacyVotes = (verdicts: readonly AiVerdict[]): ProviderVote[] =>
  orderedVerdicts(verdicts).flatMap((v) => (v.decision ? [{ provider: v.provider, decision: v.decision, savedAt: v.savedAt }] : []))

/** Cevap yeni (kategori bazlı) biçimde mi */
export const hasCategoryDecisions = (verdict: AiVerdict): boolean => verdict.byCategory !== undefined

/** Yapay zekâya bu kategori soruldu ama karar yazmadı: "cevapsız" */
export const isUnanswered = (verdict: AiVerdict, categoryId: CategoryId): boolean =>
  verdict.byCategory !== undefined && verdict.byCategory[categoryId] === undefined && (verdict.asked ?? []).includes(categoryId)
