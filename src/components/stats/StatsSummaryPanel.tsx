import { useEffect, useMemo, useState } from 'react'
import { startRankJob, type Ranks } from '../../services/stats/rankJob'
import { buildDetailCsv, buildStatsSummary, detailFileName, fillRankSection, RANK_PENDING_TEXT, scopeData, SCOPE_OPTIONS, summaryFileName, type SummaryScope } from '../../services/stats/statsSummary'
import { useApp } from '../../state/AppContext'
import type { AiVerdict, Match, MatchResult, Pick, SharedPick, Upload } from '../../types'
import { copyText } from '../../utils/clipboard'
import { shiftDate } from '../../utils/format'

interface Props {
  picks: Pick[]
  matches: Match[]
  /** Önerisi olan günlerin tüm maç kayıtları (özetteki sıra tablosu için); okunana dek null */
  dayMatches: Match[] | null
  results: MatchResult[]
  verdicts: AiVerdict[]
  shared: SharedPick[]
  /** CSV yüklemeleri (özetteki "türetme" bilgi satırı için yükleme zamanı); verilmezse o satır yazılmaz */
  uploads?: Upload[]
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

/** Sıra hesabının isteği: kapsamdaki öneriler ve günlerin maç kayıtları. Sonuç yalnızca kendi isteğiyle gösterilir. */
interface RankRequest {
  picks: Pick[]
  dayMatches: Match[] | null
}

/** İstatistiklerin analiz için düz metin özeti ve ayrıntılı CSV. Hiçbir kaydı değiştirmez. */
export default function StatsSummaryPanel({ picks, matches, dayMatches, results, verdicts, shared, uploads }: Props) {
  const { today, thresholds, marketConflictLimit } = useApp()
  const [kind, setKind] = useState<SummaryScope['kind']>('all')
  const [from, setFrom] = useState(() => shiftDate(today, -6))
  const [to, setTo] = useState(today)
  const [includeGuide, setIncludeGuide] = useState(true)
  const [copied, setCopied] = useState<boolean | null>(null)

  const scope: SummaryScope = useMemo(() => (kind === 'range' ? { kind, from, to } : { kind }), [kind, from, to])
  const base = useMemo(
    () => ({ today, scope, picks, matches, results, verdicts, shared, uploads, marketConflictLimit }),
    [today, scope, picks, matches, results, verdicts, shared, uploads, marketConflictLimit],
  )

  // Sıra tablosu sayfa çizildikten sonra, arka planda ve yalnızca kapsamdaki günler için hesaplanır.
  // Kapsam ya da veri değişince süren hesap iptal edilir; iptal edilen hesabın sonucu hiç gelmez,
  // gelen sonuç da yalnızca kendi isteği hâlâ geçerliyse gösterilir (eski sonuç yenisinin üstüne yazılmaz).
  const request = useMemo<RankRequest>(() => ({ picks: scopeData({ picks, verdicts: [], shared: [], scope, today }).picks, dayMatches }), [picks, scope, today, dayMatches])
  const [computed, setComputed] = useState<{ request: RankRequest; ranks: Ranks } | null>(null)
  useEffect(() => {
    if (!request.dayMatches) return
    const job = startRankJob(request.picks, request.dayMatches)
    void job.done.then((ranks) => ranks && setComputed({ request, ranks }))
    return () => job.cancel()
  }, [request])
  const ranks = computed?.request === request ? computed.ranks : 'pending'
  const ready = ranks !== 'pending'

  // Oluşturulma saati önizlemede sabit kalsın diye özet, girdiler değişince yeniden üretilir.
  // Özet sıra tablosu olmadan (yer tutucuyla) üretilir; tablo hazır olunca yalnızca o bölüm
  // yerine konur, özetin geri kalanı yeniden hesaplanmaz.
  const pendingText = useMemo(() => buildStatsSummary({ ...base, now: new Date(), includeGuide, thresholds, ranks: 'pending' }), [base, includeGuide, thresholds])
  const text = useMemo(() => (ranks === 'pending' ? pendingText : fillRankSection(pendingText, base, ranks)), [pendingText, base, ranks])

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
        {/* Sıra tablosu hazır olmadan özet eksiktir: kopyalama ve indirme o ana dek kapalıdır. */}
        <button type="button" onClick={async () => setCopied(await copyText(text))} disabled={!ready} data-testid="summary-copy" className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}>
          Özeti kopyala
        </button>
        <button
          type="button"
          onClick={() => saveFile(summaryFileName(today), text, 'text/plain;charset=utf-8')}
          disabled={!ready}
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
        {!ready && (
          <span role="status" data-testid="summary-pending" className="text-sm font-semibold text-muted">
            {RANK_PENDING_TEXT}
          </span>
        )}
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
        data-ready={ready}
        className="mt-3 block w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-2 font-mono text-xs leading-snug whitespace-pre outline-none"
      />
    </div>
  )
}
