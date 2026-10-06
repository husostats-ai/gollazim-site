import { useState } from 'react'
import { decisionLabel, type AiProvider } from '../../config/ai'
import { parseAiResponse, parseLine, type ParsedVerdict, type ParseError } from '../../services/ai/parser'
import { aiRepo } from '../../services/data'
import { isAfterKickoff } from '../../services/story/shared'
import type { AiVerdict, Match } from '../../types'

/** Maç kaydı yoksa başlama saati bilinemez; tahmin güvenli tarafta kalıp ölçüm dışı sayılır */
const lateFor = (match: Match | undefined, savedAt: string): boolean => (match ? isAfterKickoff(match, savedAt) : true)

interface Props {
  date: string
  provider: AiProvider
  providerLabel: string
  /** numara -> maç kimliği (kopyalanan prompt'taki numaralandırma) */
  numbers: Map<number, string>
  matchesById: Map<string, Match>
  onSaved: () => Promise<void>
}

interface Review {
  verdicts: ParsedVerdict[]
  errors: (ParseError & { key: number })[]
  ignored: number
}

export default function ResponsePanel({ date, provider, providerLabel, numbers, matchesById, onSaved }: Props) {
  const [text, setText] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const process = () => {
    const result = parseAiResponse(text, numbers)
    setReview({ ...result, errors: result.errors.map((e, i) => ({ ...e, key: i })) })
    setMessage(null)
  }

  const editError = (key: number, value: string) =>
    setReview((r) => r && { ...r, errors: r.errors.map((e) => (e.key === key ? { ...e, text: value } : e)) })

  const dropError = (key: number) => setReview((r) => r && { ...r, errors: r.errors.filter((e) => e.key !== key) })

  /** Elle düzeltilen satırı yeniden çözer; geçerliyse karar listesine taşır. */
  const retry = (key: number) =>
    setReview((r) => {
      if (!r) return r
      const error = r.errors.find((e) => e.key === key)!
      const result = parseLine(error.text, numbers)
      let failure: string | null = null
      if (result.kind === 'ignored') failure = 'Satır bir karar satırına benzemiyor.'
      else if (result.kind === 'error') failure = result.message
      else if (r.verdicts.some((v) => v.number === result.verdict.number)) {
        failure = `#${result.verdict.number} için zaten bir karar var.`
      }
      if (failure !== null || result.kind !== 'verdict') {
        return { ...r, errors: r.errors.map((e) => (e.key === key ? { ...e, message: failure ?? e.message } : e)) }
      }
      return {
        ...r,
        verdicts: [...r.verdicts, result.verdict].sort((a, b) => a.number - b.number),
        errors: r.errors.filter((e) => e.key !== key),
      }
    })

  const save = async () => {
    if (!review) return
    const savedAt = new Date().toISOString()
    const verdicts: AiVerdict[] = review.verdicts.map((v) => ({
      id: `${v.matchId}|${provider}`,
      matchId: v.matchId,
      // Karar, maçın günüyle saklanır
      date: matchesById.get(v.matchId)?.date ?? date,
      provider,
      decision: v.decision,
      reason: v.reason,
      risk: v.risk,
      savedAt,
      // Skor tahmini, kaydedildiği anla saklanır; maç başladıktan sonra kaydedilen tahmin ölçüme girmez.
      ...(v.score && { score: v.score, scoreLate: lateFor(matchesById.get(v.matchId), savedAt) }),
    }))
    await aiRepo.saveVerdicts(verdicts)
    await onSaved()
    setMessage(`${verdicts.length} ${providerLabel} kararı kaydedildi.`)
    setReview(null)
    setText('')
  }

  const missing = review ? [...numbers.keys()].filter((n) => !review.verdicts.some((v) => v.number === n)) : []

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder={'#1 | Güçlü | gerekçe | risk | SKOR: 2-1\n#2 | Orta | gerekçe | risk'}
        data-testid="ai-response"
        aria-label={`${providerLabel} cevabı`}
        className="w-full rounded-lg border border-navy-500 bg-navy-800 p-2.5 font-mono text-xs leading-relaxed outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={process}
        disabled={text.trim() === ''}
        className="mt-2 rounded-xl border border-brand px-4 py-2 text-sm font-bold text-brand hover:bg-navy-600 disabled:cursor-not-allowed disabled:border-navy-500 disabled:text-muted"
      >
        Cevabı işle
      </button>
      {message && (
        <p className="mt-3 text-sm text-win" role="status">
          {message}
        </p>
      )}

      {review && (
        <div className="mt-4 space-y-4" data-testid="ai-review">
          <p className="text-sm">
            <span className="font-bold">{review.verdicts.length} karar okundu</span>
            <span className="text-muted">
              {' '}
              · {review.errors.length} hatalı satır · {review.ignored} açıklama satırı yok sayıldı
              {missing.length > 0 && ` · cevabı olmayan maçlar: ${missing.map((n) => `#${n}`).join(', ')}`}
            </span>
          </p>

          {review.errors.length > 0 && (
            <div className="rounded-xl border border-loss-line bg-loss-soft p-3" data-testid="ai-errors">
              <p className="text-sm font-bold text-loss-text">Okunamayan satırlar</p>
              <p className="mt-0.5 text-xs text-muted">
                Satırı düzeltip “Yeniden dene”ye basın ya da satırı atın. Maçlar yalnızca numarayla eşleştirilir.
              </p>
              <ul className="mt-2 space-y-3">
                {review.errors.map((e) => (
                  <li key={e.key} data-testid="ai-error-row">
                    <p className="text-xs text-loss-text">
                      Satır {e.line}: {e.message}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <input
                        value={e.text}
                        onChange={(ev) => editError(e.key, ev.target.value)}
                        aria-label={`Satır ${e.line} düzeltme`}
                        className="min-w-0 flex-1 basis-64 rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
                      />
                      <button
                        type="button"
                        onClick={() => retry(e.key)}
                        className="rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold hover:bg-navy-600"
                      >
                        Yeniden dene
                      </button>
                      <button
                        type="button"
                        onClick={() => dropError(e.key)}
                        className="rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold text-muted hover:bg-navy-600"
                      >
                        Satırı at
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.verdicts.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-navy-500 bg-navy-800 px-3" data-testid="ai-parsed">
              {review.verdicts.map((v) => {
                const match = matchesById.get(v.matchId)
                return (
                  <li key={v.number} className="py-2 text-sm">
                    <p>
                      <span className="font-bold">#{v.number}</span>{' '}
                      <span className="font-semibold">{match ? `${match.home} – ${match.away}` : 'Maç bulunamadı'}</span>{' '}
                      <span className="rounded-full border border-navy-500 px-2 py-0.5 text-[11px] font-bold">
                        {decisionLabel(v.decision)}
                      </span>
                      {v.score && (
                        <span className="ml-1 text-[11px] font-bold whitespace-nowrap text-muted" data-testid="ai-parsed-score">
                          Skor {v.score.home}-{v.score.away}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {v.reason} {v.risk && <span>Risk: {v.risk}</span>}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={review.verdicts.length === 0}
            data-testid="ai-save"
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-40"
          >
            {review.verdicts.length} kararı {providerLabel} adına kaydet
          </button>
        </div>
      )}
    </div>
  )
}
