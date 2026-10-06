import { useEffect, useMemo, useState } from 'react'
import DatePicker from '../components/DatePicker'
import EmptyState from '../components/EmptyState'
import NoData from '../components/NoData'
import NoteBadges from '../components/NoteBadges'
import PageTitle from '../components/PageTitle'
import ReliabilityBadge from '../components/ReliabilityBadge'
import { isConsensus } from '../components/ai/AiVerdictBadges'
import PromptPanel from '../components/ai/PromptPanel'
import ResponsePanel from '../components/ai/ResponsePanel'
import { AI_PROVIDERS, decisionLabel, providerLabel, type AiProvider } from '../config/ai'
import { getCategory } from '../config/categories'
import { collectAiMatches } from '../services/ai/collect'
import { numberMap } from '../services/ai/parser'
import { buildPrompts } from '../services/ai/prompt'
import { analyzeDay } from '../services/analysis/engine'
import { aiRepo } from '../services/data'
import { useApp } from '../state/AppContext'
import type { AiPromptBatch, AiVerdict } from '../types'
import { formatLongDate } from '../utils/format'

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])
const copiedAtFmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })

export default function AiPage() {
  const { matches, thresholds, selectedDate, dates, loading, aiVerdicts, refresh, dataVersion } = useApp()
  const [provider, setProvider] = useState<AiProvider>('chatgpt')
  const [batch, setBatch] = useState<AiPromptBatch | null>(null)

  // Liste her zaman yüzdeye göre sıralı analizden çıkar; temkinli sıra seçimi etkilemez.
  const items = useMemo(() => collectAiMatches(analyzeDay(matches, thresholds, 'percent')), [matches, thresholds])
  const liveIds = useMemo(() => items.map((i) => i.match.id), [items])

  useEffect(() => {
    let cancelled = false
    setBatch(null)
    if (selectedDate) {
      void aiRepo.getPromptBatch(selectedDate, provider).then((b) => !cancelled && setBatch(b ?? null))
    }
    return () => {
      cancelled = true
    }
  }, [selectedDate, provider, dataVersion])

  if (loading) return <PageTitle title="AI ANALİZİ" />
  if (dates.length === 0 || !selectedDate) {
    return (
      <>
        <PageTitle title="AI ANALİZİ" />
        <NoData />
      </>
    )
  }

  const label = providerLabel(provider)
  // Cevap, kopyalanan son prompt'un numaralarına göre eşleştirilir; hiç kopyalanmadıysa güncel listeye göre.
  const numberedIds = batch?.matchIds ?? liveIds
  const numbers = numberMap(numberedIds)
  const stale = batch !== null && !sameIds(batch.matchIds, liveIds)
  const chunks = buildPrompts(items, provider, formatLongDate(selectedDate))
  const matchesById = new Map(matches.map((m) => [m.id, m]))
  const verdictsOf = (matchId: string): AiVerdict[] =>
    AI_PROVIDERS.map((p) => aiVerdicts.find((v) => v.matchId === matchId && v.provider === p.id)).filter(
      (v): v is AiVerdict => v !== undefined,
    )

  const onCopied = async () => {
    const next: AiPromptBatch = {
      id: `${selectedDate}|${provider}`,
      date: selectedDate,
      provider,
      createdAt: new Date().toISOString(),
      matchIds: liveIds,
    }
    await aiRepo.savePromptBatch(next)
    setBatch(next)
  }

  const removeVerdict = async (id: string) => {
    await aiRepo.removeVerdict(id)
    await refresh()
  }

  return (
    <>
      <PageTitle
        title="AI ANALİZİ"
        subtitle="Site hiçbir veriyi kendiliğinden göndermez ve API anahtarı kullanmaz. Prompt’u kopyalayıp kendi ChatGPT ya da Gemini uygulamanıza yapıştırırsınız; cevabı buraya geri yapıştırırsınız."
      />
      <div className="mb-4 space-y-3">
        <DatePicker />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            <span className="font-bold text-white">{formatLongDate(selectedDate)}</span> · eşiği geçen {items.length}{' '}
            maç
          </p>
          <div className="inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Yapay zekâ">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={provider === p.id}
                onClick={() => setProvider(p.id)}
                className={`rounded-[10px] px-4 py-1.5 text-sm font-bold transition-colors ${
                  provider === p.id ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState>Bu tarihte eşiği geçen maç yok; yapay zekâya sorulacak bir şey bulunmuyor.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
            <h2 className="font-extrabold tracking-wide">1. {label.toUpperCase()} İÇİN PROMPT</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              Her maçın bir numarası var (#1, #2 …). Cevap bu numaralarla geri eşleştirilir.
            </p>
            <PromptPanel chunks={chunks} providerLabel={label} onCopied={onCopied} />
          </section>

          <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
            <h2 className="font-extrabold tracking-wide">2. {label.toUpperCase()} CEVABINI YAPIŞTIR</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              Beklenen biçim, her maç için tek satır: <code className="text-white">#numara | KARAR | gerekçe | risk</code>
            </p>
            {batch && (
              <p className="mb-3 text-xs text-muted" data-testid="batch-info">
                Numaralar, {copiedAtFmt.format(new Date(batch.createdAt))} tarihinde kopyalanan {label} prompt’una göre (
                {batch.matchIds.length} maç).
              </p>
            )}
            {stale && (
              <p className="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn" data-testid="stale-warning">
                ⚠ Maç listesi, son kopyaladığınız prompt’tan sonra değişti (eşik ya da veri değişikliği). Yapıştırdığınız
                cevap, kopyaladığınız prompt’un numaralarına göre eşleştirilir. Güncel listeyle çalışmak için prompt’u
                yeniden kopyalayın.
              </p>
            )}
            <ResponsePanel
              key={`${selectedDate}|${provider}`}
              date={selectedDate}
              provider={provider}
              providerLabel={label}
              numbers={numbers}
              matchesById={matchesById}
              onSaved={refresh}
            />
          </section>

          <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
            <h2 className="font-extrabold tracking-wide">MAÇLAR VE KARARLAR</h2>
            <ul className="mt-2 divide-y divide-line">
              {items.map((item) => {
                const number = numberedIds.indexOf(item.match.id) + 1
                const verdicts = verdictsOf(item.match.id)
                return (
                  <li key={item.match.id} className="py-3" data-testid="ai-match">
                    <div className="flex items-start gap-2.5">
                      <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-full bg-navy-600 px-1.5 text-xs font-bold">
                        {number > 0 ? `#${number}` : '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-extrabold break-words">
                          {item.match.home} <span className="text-muted">–</span> {item.match.away}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {[item.match.time, item.match.league].filter(Boolean).join(' · ')}
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {item.predictions.map((p) => (
                            <li key={p.categoryId} className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="font-bold text-brand">{getCategory(p.categoryId).label}</span>
                              <span className="font-bold">%{p.percent}</span>
                              <ReliabilityBadge reliability={p.reliability} compact />
                              <NoteBadges notes={p.notes} />
                            </li>
                          ))}
                        </ul>

                        {verdicts.length > 0 && (
                          <ul className="mt-2 space-y-1.5" data-testid="ai-verdicts">
                            {verdicts.map((v) => (
                              <li key={v.id} className="rounded-lg bg-navy-800 px-2.5 py-2 text-xs" data-ai={v.provider}>
                                <p className="flex flex-wrap items-center justify-between gap-2">
                                  <span>
                                    <span className="font-bold text-muted">{providerLabel(v.provider)}:</span>{' '}
                                    <span className="font-extrabold">{decisionLabel(v.decision)}</span>
                                    {v.score && (
                                      <span className="ml-1.5 font-semibold text-muted" data-testid="ai-verdict-score">
                                        · Skor {v.score.home}-{v.score.away}
                                        {v.scoreLate && ' (başladıktan sonra; ölçüme girmez)'}
                                      </span>
                                    )}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void removeVerdict(v.id)}
                                    className="rounded-md border border-navy-500 px-2 py-0.5 text-[11px] font-bold text-muted hover:bg-navy-600"
                                  >
                                    Kararı sil
                                  </button>
                                </p>
                                <p className="mt-1 text-muted">{v.reason}</p>
                                {v.risk && (
                                  <p className="mt-0.5 text-muted">
                                    <span className="font-semibold text-white">Risk:</span> {v.risk}
                                  </p>
                                )}
                              </li>
                            ))}
                            {isConsensus(verdicts) && (
                              <li>
                                <span className="inline-flex rounded-full border border-info-line bg-info-soft px-2 py-0.5 text-[11px] font-bold text-info">
                                  Ortak karar
                                </span>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      )}
    </>
  )
}
