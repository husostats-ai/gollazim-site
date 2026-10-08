import { isAiCategory, providerLabel, decisionLabel } from '../../config/ai'
import type { CategoryId } from '../../config/categories'
import { aiShareId, memberShareRow } from '../../services/ai/memberShare'
import { agreementText, MAJORITY_NOTE, summarizeVerdicts, type Agreement } from '../../services/ai/consensus'
import { categoryVotes, isUnanswered, legacyVotes, orderedVerdicts } from '../../services/ai/verdicts'
import { useApp } from '../../state/AppContext'
import type { AiShare, AiVerdict, Match } from '../../types'

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap'

/** Karar özeti rozeti: "3/3 aynı · Orta", "2/3 çoğunluk · Orta", "3 farklı". Tek karar varken çıkmaz. */
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
 * Bu kategorideki "AI öneri güveni" satırının üyeye gidip gitmediği. Gitti: satır bir yayınla
 * üyelere gönderildi. Gider: şartlar şu an sağlanıyor, bir sonraki "Yayınla" ile gidecek
 * (maç o listede üyeye de görünüyorsa).
 */
export function MemberShareBadge({ match, verdicts, categoryId, shares }: { match: Pick<Match, 'id' | 'date' | 'time'> | undefined; verdicts: AiVerdict[]; categoryId: CategoryId; shares: AiShare[] }) {
  const share = match ? shares.find((s) => s.id === aiShareId(match.id, categoryId)) : undefined
  const eligible = match !== undefined && memberShareRow(match, verdicts, categoryId) !== null
  if (!share && !eligible) return null
  const title = share
    ? `Bu kategorinin “AI öneri güveni” satırı üyelere gönderildi (ilk yayın no ${share.firstN}, son yayın no ${share.lastN}).${eligible ? '' : ' Şartlar artık sağlanmıyor: bir sonraki yayında satır üyeden kalkar.'}`
    : 'Şartlar sağlanıyor: bir sonraki “Yayınla” ile bu kategorinin “AI öneri güveni” satırı üyelere gider (yalnızca karar seviyeleri).'
  return (
    <span className={`${chip} border-win-line bg-win-soft font-bold text-win`} data-testid="ai-member-share" data-share={share ? 'sent' : 'pending'} title={title}>
      {share ? 'Üyeye gitti' : 'Üyeye gider'}
    </span>
  )
}

function ScoreText({ verdict }: { verdict: AiVerdict }) {
  if (!verdict.score) return null
  return (
    <span className="text-muted" data-testid="ai-score" title={verdict.scoreLate ? 'Skor tahmini maç başladıktan sonra kaydedildi; ölçüme girmez.' : 'Skor tahmini'}>
      · {verdict.score.home}-{verdict.score.away}
      {verdict.scoreLate && ' (başladıktan sonra)'}
    </span>
  )
}

/** Eski maç geneli kararlar: ayrı ve soluk gösterilir; kategori kararı değildir, üyeye gitmez. */
export function LegacyVerdicts({ verdicts }: { verdicts: AiVerdict[] }) {
  const votes = legacyVotes(verdicts)
  if (votes.length === 0) return null
  return (
    <span
      className={`${chip} max-w-full flex-wrap border-dashed border-navy-500 whitespace-normal text-muted`}
      data-testid="ai-legacy"
      title="Kategori bazlı karara geçilmeden önce kaydedilmiş, maçın tüm önerilerini birlikte kapsayan karar. Kategori kararına çevrilmez ve üyeye gitmez."
    >
      <span>Maç geneli (eski):</span>
      {votes.map((vote) => (
        <span key={vote.provider}>
          {providerLabel(vote.provider)} <span className="font-bold">{decisionLabel(vote.decision)}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Maçın bu karttaki kategoriye ait yapay zekâ kararları. Karar istenen dört kategoride her yapay
 * zekânın O KATEGORİYE verdiği karar, özet ve "üyeye gider / gitti" işareti görünür; diğer
 * kategorilerin kartlarında yalnızca skor tahminleri görünür. Skor tahmini maça aittir, her kartta durur.
 */
export default function AiVerdictBadges({ matchId, categoryId }: { matchId: string; categoryId: CategoryId }) {
  const { aiVerdicts, aiShares, matches } = useApp()
  const verdicts = orderedVerdicts(aiVerdicts.filter((v) => v.matchId === matchId))
  if (verdicts.length === 0) return null
  const scoped = isAiCategory(categoryId)
  const votes = scoped ? categoryVotes(verdicts, categoryId) : []
  // Bu kartta gösterilecek bir şeyi olan cevaplar: kategori kararı, "cevapsız" bilgisi ya da skor tahmini.
  const shown = verdicts.filter((v) => (scoped && (v.byCategory?.[categoryId] !== undefined || isUnanswered(v, categoryId))) || v.score)
  const legacy = legacyVotes(verdicts).length > 0
  if (shown.length === 0 && !legacy) return null
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="ai-badges">
      {shown.map((v) => {
        const decision = scoped ? v.byCategory?.[categoryId] : undefined
        const unanswered = scoped && isUnanswered(v, categoryId)
        return (
          <span key={v.id} title={`${v.reason}${v.risk ? ` Risk: ${v.risk}` : ''}`} data-ai={v.provider} className={`${chip} border-navy-500 bg-navy-800`}>
            <span className="text-muted">
              {providerLabel(v.provider)}
              {(decision || unanswered) && ':'}
            </span>
            {decision && <span className="font-bold">{decisionLabel(decision)}</span>}
            {unanswered && <span className="text-muted italic">cevapsız</span>}
            <ScoreText verdict={v} />
          </span>
        )
      })}
      {scoped && <AgreementBadge agreement={summarizeVerdicts(votes)} />}
      {scoped && <MemberShareBadge match={matches.find((m) => m.id === matchId)} verdicts={verdicts} categoryId={categoryId} shares={aiShares} />}
      <LegacyVerdicts verdicts={verdicts} />
    </div>
  )
}
