import { decisionLabel } from '../../config/ai'
import { AI_SOURCES, type AiSource, type AiStats } from '../../services/ai/aiStats'
import RateBars from './RateBars'
import RateText from './RateText'

const SOURCE_LABELS: Record<AiSource, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', consensus: 'Ortak karar' }

export default function AiStatsCard({ stats }: { stats: AiStats }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-extrabold tracking-wide">ONAYLADIĞI MAÇLARDA BAŞARI</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Onay: “Güçlü” ya da “Orta” kararı. Ortak karar: iki yapay zekânın aynı kararı verdiği maçlar. Kararı kayıtlı
          maç sayısı: {AI_SOURCES.map((s) => `${SOURCE_LABELS[s]} ${stats.matches[s]}`).join(', ')}.
        </p>
        <RateBars
          rows={AI_SOURCES.map((s) => ({
            key: s,
            label: s === 'consensus' ? 'Ortak onay' : `${SOURCE_LABELS[s]} onayı`,
            tally: stats.approved[s],
          }))}
        />
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-extrabold tracking-wide">KARAR SEVİYESİNE GÖRE BAŞARI</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Karar isabetliyse “Güçlü” satırı yüksek, “Eleme” satırı düşük başarı gösterir.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm" data-testid="ai-level-table">
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
    </div>
  )
}
