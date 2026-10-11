import { AI_PROVIDERS, decisionLabel } from '../../config/ai'
import { AI_SOURCES, approvalEdge, type AiSource, type AiStats, type PreMatchAiStats } from '../../services/ai/aiStats'
import { MAJORITY_NOTE } from '../../services/ai/consensus'
import { formatPoints, formatRate } from '../../utils/format'
import RateBars, { type RateBarRow } from './RateBars'
import RateText from './RateText'

const SOURCE_LABELS = { ...Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p.label])), majority: 'Çoğunluk kararı' } as Record<AiSource, string>

const approvalLabel = (s: AiSource): string => (s === 'majority' ? 'Çoğunluk onayı' : `${SOURCE_LABELS[s]} onayı`)

/** Onay ve onaylamadığı satırları yan yana; onay satırında kaynağın kendi karar verdiği önerilere göre fark */
function comparisonRows(stats: PreMatchAiStats): RateBarRow[] {
  return [
    { key: 'all', label: 'Tümü (karşılaştırma)', tally: stats.all },
    ...AI_SOURCES.flatMap((s): RateBarRow[] => {
      const edge = approvalEdge(stats.approved[s], stats.judged[s])
      return [
        {
          key: s,
          label: approvalLabel(s),
          tally: stats.approved[s],
          extra: edge === null ? undefined : `${formatPoints(edge)} puan (karar verdiği tümü ${formatRate(stats.judged[s].rate)} · ${stats.judged[s].decided})`,
        },
        { key: `${s}-rejected`, label: s === 'majority' ? 'Çoğunluğun onaylamadığı' : `${SOURCE_LABELS[s]} onaylamadığı`, tally: stats.rejected[s], paired: true },
      ]
    }),
  ]
}

/**
 * kind: kategori bazlı kararlar (birim: maç + kategori) ya da eski maç geneli kararlar (birim: maç).
 * Kategori bazlı kartta yalnızca maç başlamadan önce kaydedilmiş kararlar ölçülür ve karşılaştırma satırları eklenir.
 */
export default function AiStatsCard({ stats, kind }: { stats: AiStats | PreMatchAiStats; kind: 'category' | 'legacy' }) {
  const unit = kind === 'category' ? 'öneri (maç + kategori)' : 'maç'
  const compared = 'judged' in stats ? stats : null
  const excluded = compared ? compared.excluded.late + compared.excluded.noKickoff : 0
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-extrabold tracking-wide">{compared ? 'ONAYLADIĞI VE ONAYLAMADIĞI ÖNERİLERDE BAŞARI' : 'ONAYLADIĞI ÖNERİLERDE BAŞARI'}</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Onay: “Güçlü” ya da “Orta” kararı. Çoğunluk kararı: {kind === 'category' ? 'o kategoride ' : ''}karar veren yapay zekâların
          yarısından fazlasının aynı seviyede verdiği karar (ortalama alınmaz). Kararı kayıtlı {unit} sayısı:{' '}
          {AI_SOURCES.map((s) => `${SOURCE_LABELS[s]} ${stats.units[s]}`).join(', ')}.
        </p>
        <p className="-mt-2 mb-3 text-xs text-muted" data-testid="ai-majority-note">
          {MAJORITY_NOTE}
        </p>
        {compared && (
          <p className="-mt-2 mb-3 text-xs text-muted" data-testid="ai-compare-note">
            Tümü: en az bir yapay zekânın kararı olan bütün öneriler (onay ya da eleme fark etmez). Onaylamadığı: “Zayıf” ya da
            “Eleme” kararı. Onay satırındaki fark, yüzde puan olarak: onayladıklarındaki başarı − o kaynağın karar verdiği bütün
            önerilerdeki başarı.
          </p>
        )}
        <RateBars rows={compared ? comparisonRows(compared) : AI_SOURCES.map((s) => ({ key: s, label: approvalLabel(s), tally: stats.approved[s] }))} />
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-extrabold tracking-wide">KARAR SEVİYESİNE GÖRE BAŞARI</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Karar isabetliyse “Güçlü” satırı yüksek, “Eleme” satırı düşük başarı gösterir.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm" data-testid={`ai-level-table-${kind}`}>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Karar</th>
                {AI_SOURCES.map((s) => (
                  <th key={s} className="py-2 pr-3 font-semibold">
                    {SOURCE_LABELS[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.byDecision.map(({ decision, tallies }) => (
                <tr key={decision} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {decisionLabel(decision)}
                  </th>
                  {AI_SOURCES.map((s) => (
                    <td key={s} className="py-2 pr-3 align-top">
                      <RateText tally={tallies[s]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {compared && (
        <p className="text-xs text-muted lg:col-span-2" data-testid="ai-excluded-note" data-late={compared.excluded.late} data-no-kickoff={compared.excluded.noKickoff}>
          Bu bölümde yalnızca maç başlamadan önce kaydedilmiş kararlar ölçülür.{' '}
          {excluded === 0
            ? 'Bu yüzden hariç kalan karar yok.'
            : `Hariç kalan karar (yapay zekâ + maç + kategori): ${excluded}. Maç başladıktan sonra kaydedilen: ${compared.excluded.late}; başlama saati bilinmeyen: ${compared.excluded.noKickoff}.`}
        </p>
      )}
    </div>
  )
}
