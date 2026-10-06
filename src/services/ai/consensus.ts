import { AI_PROVIDERS } from '../../config/ai'
import type { AiVerdict } from '../../types'

/** İki yapay zekâ da karar verdiyse ve kararlar aynıysa true */
export const isConsensus = (verdicts: AiVerdict[]): boolean =>
  verdicts.length === AI_PROVIDERS.length && verdicts.every((v) => v.decision === verdicts[0].decision)
