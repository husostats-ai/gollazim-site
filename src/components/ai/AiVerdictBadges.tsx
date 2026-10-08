import { AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { memberShareRow } from '../../services/ai/memberShare'
import { agreementText, MAJORITY_NOTE, summarizeVerdicts, type Agreement } from '../../services/ai/consensus'
import { useApp } from '../../state/AppContext'
import type { AiShare, AiVerdict, Match } from '../../types'

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap'

/** Karar özeti rozeti: "3/3 aynı", "2/3 çoğunluk · Orta", "3 farklı". Tek karar varken çıkmaz. */
export function AgreementBadge({ agreement }: { agreement: Agreement | null }) {
  if (!agreement) return null
  const tone = agreement.kind === 'split' ? 'border-navy-500 bg-navy-800 text-muted' : 'border-info-line bg-info-soft text-info'
  return (
    <span
      className={`${chip} font-bold ${tone}`}
      data-testid="ai-agreement"
      data-agreement={agreement.kind}
      title={`${agreement.voters} yapay zekânın kararı karşılaştırıldı; ortalama alınmaz. ${MAJORITY_NOTE}`}
    >
      {agreementText(agreement)}
    </span>
  )
}

/**
 * "AI öneri güveni" satırının üyeye gidip gitmediği. Gitti: satır bir yayınla üyelere gönderildi.
 * Gider: şartlar şu an sağlanıyor, bir sonraki "Yayınla" ile gidecek (maç üye listelerindeyse).
 */
export function MemberShareBadge({ match, verdicts, share }: { match: Pick<Match, 'date' | 'time'> | undefined; verdicts: AiVerdict[]; share: AiShare | undefined }) {
  const eligible = match !== undefined && memberShareRow(match, verdicts) !== null
  if (!share && !eligible) return null
  const title = share
    ? `“AI öneri güveni” satırı üyelere gönderildi (ilk yayın no ${share.firstN}, son yayın no ${share.lastN}).${eligible ? '' : ' Şartlar artık sağlanmıyor: bir sonraki yayında satır üyeden kalkar.'}`
    : 'Şartlar sağlanıyor: bir sonraki “Yayınla” ile “AI öneri güveni” satırı üyelere gider (yalnızca karar seviyeleri).'
  return (
    <span className={`${chip} border-win-line bg-win-soft font-bold text-win`} data-testid="ai-member-share" data-share={share ? 'sent' : 'pending'} title={title}>
      {share ? 'Üyeye gitti' : 'Üyeye gider'}
    </span>
  )
}

/** Maçın kayıtlı yapay zekâ kararları; her karar hangi yapay zekâdan geldiğiyle etiketlidir. */
export default function AiVerdictBadges({ matchId }: { matchId: string }) {
  const { aiVerdicts, aiShares, matches } = useApp()
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
          {v.score && (
            <span className="text-muted" data-testid="ai-score" title={v.scoreLate ? 'Skor tahmini maç başladıktan sonra kaydedildi; ölçüme girmez.' : 'Skor tahmini'}>
              · {v.score.home}-{v.score.away}
              {v.scoreLate && ' (başladıktan sonra)'}
            </span>
          )}
        </span>
      ))}
      <AgreementBadge agreement={summarizeVerdicts(verdicts)} />
      <MemberShareBadge match={matches.find((m) => m.id === matchId)} verdicts={verdicts} share={aiShares.find((s) => s.matchId === matchId)} />
    </div>
  )
}
