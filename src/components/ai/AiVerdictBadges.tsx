import { AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { isConsensus } from '../../services/ai/consensus'
import { useApp } from '../../state/AppContext'
import type { AiVerdict } from '../../types'

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap'

export { isConsensus }

/** Maçın kayıtlı yapay zekâ kararları; her karar hangi yapay zekâdan geldiğiyle etiketlidir. */
export default function AiVerdictBadges({ matchId }: { matchId: string }) {
  const { aiVerdicts } = useApp()
  const verdicts = AI_PROVIDERS.map((p) => aiVerdicts.find((v) => v.matchId === matchId && v.provider === p.id)).filter(
    (v): v is AiVerdict => v !== undefined,
  )
  if (verdicts.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="ai-badges">
      {verdicts.map((v) => (
        <span
          key={v.id}
          title={`${v.reason}${v.risk ? ` Risk: ${v.risk}` : ''}`}
          data-ai={v.provider}
          className={`${chip} border-navy-500 bg-navy-800`}
        >
          <span className="text-muted">{AI_PROVIDERS.find((p) => p.id === v.provider)!.label}:</span>
          <span className="font-bold">{decisionLabel(v.decision)}</span>
        </span>
      ))}
      {isConsensus(verdicts) && (
        <span className={`${chip} border-info-line bg-info-soft font-bold text-info`} data-testid="ai-consensus">
          Ortak karar
        </span>
      )}
    </div>
  )
}
