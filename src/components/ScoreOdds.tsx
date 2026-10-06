import { useState } from 'react'
import { scoreForecast, sourceLabel } from '../services/analysis/scoreForecast'
import type { Match } from '../types'

const percent = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct = (probability: number): string => `%${percent.format(probability * 100)}`
const TOTAL_LABELS = ['0 gol', '1 gol', '2 gol', '3 gol', '4+ gol']

/**
 * Kartta açılır "Skor olasılıkları" detayı. Taraf & Gol'deki skor modelinden okunur;
 * yalnızca iç kullanım içindir (görsellere ve paylaşım metinlerine girmez).
 */
export default function ScoreOdds({ match }: { match: Match }) {
  const [open, setOpen] = useState(false)
  // Hesap yalnızca detay açılınca yapılır.
  const forecast = open ? scoreForecast(match) : null
  return (
    <div className="min-w-0 text-xs" data-testid="score-odds">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid="score-odds-toggle"
        className="-my-1 py-1 font-bold text-brand hover:underline"
      >
        Skor olasılıkları {open ? '▲' : '▼'}
      </button>
      {open &&
        (forecast ? (
          <div className="mt-2 rounded-xl border border-line bg-navy-800 p-2.5" data-testid="score-odds-body">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full border border-navy-500 bg-navy-600 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted" data-testid="score-odds-source">
                {sourceLabel(forecast.source)}
              </span>
              <span className="font-semibold" data-testid="score-odds-top">
                {forecast.top.map((s) => `${s.home}-${s.away} ${pct(s.probability)}`).join(' · ')}
              </span>
            </p>
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted" data-testid="score-odds-totals">
              {forecast.totals.map((p, i) => (
                <span key={TOTAL_LABELS[i]} className="whitespace-nowrap">
                  {TOTAL_LABELS[i]} <span className="font-semibold text-white">{pct(p)}</span>
                </span>
              ))}
            </p>
            <p className="mt-1.5 text-[11px] text-muted">Model tahminidir; tek bir skorun tutma ihtimali genelde düşüktür.</p>
          </div>
        ) : (
          <p className="mt-2 text-muted" data-testid="score-odds-empty">
            Veri yok
          </p>
        ))}
    </div>
  )
}
