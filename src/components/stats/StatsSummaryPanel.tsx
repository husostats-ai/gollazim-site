import { useMemo, useState } from 'react'
import { buildDetailCsv, buildStatsSummary, detailFileName, SCOPE_OPTIONS, summaryFileName, type SummaryScope } from '../../services/stats/statsSummary'
import { useApp } from '../../state/AppContext'
import type { AiVerdict, Match, MatchResult, Pick, SharedPick } from '../../types'
import { copyText } from '../../utils/clipboard'
import { shiftDate } from '../../utils/format'

interface Props {
  picks: Pick[]
  matches: Match[]
  results: MatchResult[]
  verdicts: AiVerdict[]
  shared: SharedPick[]
}

const BUTTON = 'rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60'
const DATE_INPUT = 'min-w-0 rounded-lg border border-navy-500 bg-navy-800 px-2 py-1.5 text-sm font-semibold text-white'

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** İstatistiklerin analiz için düz metin özeti ve ayrıntılı CSV. Hiçbir kaydı değiştirmez. */
export default function StatsSummaryPanel({ picks, matches, results, verdicts, shared }: Props) {
  const { today, thresholds, marketConflictLimit } = useApp()
  const [kind, setKind] = useState<SummaryScope['kind']>('all')
  const [from, setFrom] = useState(() => shiftDate(today, -6))
  const [to, setTo] = useState(today)
  const [includeGuide, setIncludeGuide] = useState(true)
  const [copied, setCopied] = useState<boolean | null>(null)

  const scope: SummaryScope = useMemo(() => (kind === 'range' ? { kind, from, to } : { kind }), [kind, from, to])
  const base = useMemo(
    () => ({ today, scope, picks, matches, results, verdicts, shared, marketConflictLimit }),
    [today, scope, picks, matches, results, verdicts, shared, marketConflictLimit],
  )
  // Oluşturulma saati önizlemede sabit kalsın diye özet, girdiler değişince yeniden üretilir.
  const text = useMemo(() => buildStatsSummary({ ...base, now: new Date(), includeGuide, thresholds }), [base, includeGuide, thresholds])

  return (
    <div className="min-w-0" data-testid="stats-summary">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex max-w-full flex-wrap rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Kapsam">
          {SCOPE_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              aria-pressed={kind === option.kind}
              onClick={() => {
                setKind(option.kind)
                setCopied(null)
              }}
              data-testid={`summary-scope-${option.kind}`}
              className={`rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
                kind === option.kind ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {kind === 'range' && (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Başlangıç" data-testid="summary-from" className={DATE_INPUT} />
            <span className="text-muted">–</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Bitiş" data-testid="summary-to" className={DATE_INPUT} />
          </span>
        )}
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={includeGuide}
          onChange={(e) => {
            setIncludeGuide(e.target.checked)
            setCopied(null)
          }}
          data-testid="summary-guide"
          className="h-5 w-5 shrink-0 accent-brand"
        />
        AI için kısa yönerge ekle
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={async () => setCopied(await copyText(text))} data-testid="summary-copy" className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}>
          Özeti kopyala
        </button>
        <button
          type="button"
          onClick={() => saveFile(summaryFileName(today), text, 'text/plain;charset=utf-8')}
          data-testid="summary-download"
          className={`${BUTTON} border border-brand text-brand hover:bg-navy-600`}
        >
          İndir (.txt)
        </button>
        <button
          type="button"
          // Excel'in Türkçe harfleri doğru açması için dosya BOM ile başlar.
          onClick={() => saveFile(detailFileName(today), `﻿${buildDetailCsv(base)}`, 'text/csv;charset=utf-8')}
          disabled={picks.length === 0}
          data-testid="summary-csv"
          className={`${BUTTON} border border-navy-500 hover:bg-navy-600`}
        >
          Ayrıntılı maç tablosu (CSV) indir
        </button>
        {copied !== null && (
          <span role="status" data-testid="summary-copied" className={`text-sm font-semibold ${copied ? 'text-win' : 'text-loss-text'}`}>
            {copied ? 'Kopyalandı' : 'Kopyalanamadı; metni önizlemeden seçip kopyalayın'}
          </span>
        )}
      </div>

      <textarea
        readOnly
        value={text}
        rows={12}
        aria-label="Özet önizlemesi"
        data-testid="summary-preview"
        className="mt-3 block w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-2 font-mono text-xs leading-snug whitespace-pre outline-none"
      />
    </div>
  )
}
