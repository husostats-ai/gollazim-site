import { useState, type FormEvent } from 'react'
import { CATEGORIES, getCategory } from '../config/categories'
import { secondHalfGoals } from '../services/results/evaluator'
import { deleteResult, saveResult, ScoreValidationError } from '../services/results/resultService'
import { parseScores, STATUS_LABELS, type ScoreDraft, type ScoreField } from '../services/results/validation'
import { useApp } from '../state/AppContext'
import type { Match, MatchResult, MatchStatus } from '../types'
import OutcomeBadge from './OutcomeBadge'

const ROWS: { label: string; hint?: string; home: ScoreField; away: ScoreField }[] = [
  { label: 'İlk Yarı', home: 'htHome', away: 'htAway' },
  { label: 'Maç Sonucu', home: 'ftHome', away: 'ftAway' },
  { label: 'Korner', hint: 'isteğe bağlı', home: 'cornersHome', away: 'cornersAway' },
  { label: 'Toplam kart (sarı + kırmızı)', hint: 'isteğe bağlı', home: 'cardsHome', away: 'cardsAway' },
]
const FIELDS = ROWS.flatMap((r) => [r.home, r.away])
const STATUSES: MatchStatus[] = ['completed', 'pending', 'postponed', 'cancelled']

const toDraft = (result: MatchResult | undefined): ScoreDraft =>
  Object.fromEntries(FIELDS.map((f) => [f, result?.[f] != null ? String(result[f]) : ''])) as ScoreDraft

const inputClass =
  'w-14 rounded-lg border border-navy-500 bg-navy-800 px-1 py-1.5 text-center text-base font-bold outline-none focus:border-brand'

/** Girilen değerlerden anlık 2. yarı skoru; hesaplanamıyorsa null */
const secondHalfText = (draft: ScoreDraft, status: MatchStatus): string | null => {
  const parsed = parseScores(draft, status)
  if (!parsed.ok) return null
  const { htHome, htAway, ftHome, ftAway } = parsed.scores
  if (htHome === null || htAway === null || ftHome === null || ftAway === null) return null
  const total = secondHalfGoals({ ...parsed.scores, matchId: '', status, updatedAt: '' })
  return `${ftHome - htHome} - ${ftAway - htAway} (${total} gol)`
}

export default function ScoreForm({ match }: { match: Match }) {
  const { results, picks, analysis, refresh } = useApp()
  const saved = results[match.id]
  const [draft, setDraft] = useState<ScoreDraft>(() => toDraft(saved))
  const [status, setStatus] = useState<MatchStatus>(saved?.status ?? 'completed')
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const categoryOrder = (id: string) => CATEGORIES.findIndex((c) => c.id === id)
  const frozen = picks
    .filter((p) => p.matchId === match.id)
    .sort((a, b) => categoryOrder(a.categoryId) - categoryOrder(b.categoryId))
  // Henüz dondurulmadıysa: maçın şu an önerildiği kategoriler (yüzdeye göre sıralı listede)
  const live = CATEGORIES.flatMap((c) => analysis[c.id].predictions.filter((p) => p.match.id === match.id))
  const secondHalf = secondHalfText(draft, status)

  const edit = (field: ScoreField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setMessage(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors([])
    setMessage(null)
    try {
      await saveResult(match.id, draft, status)
      await refresh()
      setMessage(saved ? 'Skor güncellendi, sonuçlar yeniden hesaplandı.' : 'Skor kaydedildi.')
    } catch (err) {
      setErrors(err instanceof ScoreValidationError ? err.errors : ['Skor kaydedilirken beklenmeyen bir hata oluştu.'])
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    setBusy(true)
    await deleteResult(match.id)
    setDraft(toDraft(undefined))
    setStatus('completed')
    setConfirmDelete(false)
    setErrors([])
    setMessage('Skor silindi.')
    await refresh()
    setBusy(false)
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="score-form"
      className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4"
      noValidate
    >
      <p className="truncate text-xs text-muted">{[match.time, match.league].filter(Boolean).join(' · ')}</p>
      <h3 className="mt-0.5 text-base font-extrabold break-words">
        {match.home} <span className="text-muted">–</span> {match.away}
      </h3>

      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pick-list">
        {frozen.length > 0 ? (
          frozen.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-navy-800 py-0.5 pr-0.5 pl-2.5 text-[11px]">
              <span className="font-bold">{getCategory(p.categoryId).label}</span>
              <span className="text-muted">%{p.percent}</span>
              <OutcomeBadge outcome={p.outcome} />
            </span>
          ))
        ) : live.length > 0 ? (
          live.map((p) => (
            <span key={p.categoryId} className="rounded-full bg-navy-800 px-2.5 py-1 text-[11px]">
              <span className="font-bold">{getCategory(p.categoryId).label}</span>{' '}
              <span className="text-muted">%{p.percent}</span>
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">Bu maç şu an hiçbir kategoride önerilmiyor.</span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {ROWS.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {row.label}
              {row.hint && <span className="block text-[11px] font-normal text-muted">{row.hint}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <input
                className={inputClass}
                inputMode="numeric"
                aria-label={`${row.label} ev sahibi`}
                data-field={row.home}
                value={draft[row.home]}
                onChange={(e) => edit(row.home, e.target.value)}
              />
              <span className="text-muted">-</span>
              <input
                className={inputClass}
                inputMode="numeric"
                aria-label={`${row.label} deplasman`}
                data-field={row.away}
                value={draft[row.away]}
                onChange={(e) => edit(row.away, e.target.value)}
              />
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">
            2. Yarı<span className="block text-[11px] font-normal text-muted">otomatik hesaplanır</span>
          </span>
          <span className="font-bold" data-testid="second-half">
            {secondHalf ?? <span className="font-normal text-muted">—</span>}
          </span>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm font-semibold">
          Durum
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as MatchStatus)
              setMessage(null)
            }}
            className="rounded-lg border border-navy-500 bg-navy-800 px-2 py-1.5 text-sm font-bold outline-none focus:border-brand"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="mt-3 list-disc space-y-0.5 rounded-xl border border-loss-line bg-loss-soft py-2 pr-3 pl-7 text-sm text-loss-text"
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {message && <p className="mt-3 text-sm text-win">{message}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-brand px-5 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-50"
        >
          KAYDET
        </button>
        {saved &&
          (confirmDelete ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted">Skor silinsin mi?</span>
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-lg bg-loss px-3 py-1.5 font-bold text-white disabled:opacity-50"
              >
                Evet, sil
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-navy-500 px-3 py-1.5 font-bold"
              >
                Vazgeç
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-loss-line px-3 py-1.5 text-xs font-bold text-loss-text hover:bg-loss-soft"
            >
              Skoru sil
            </button>
          ))}
      </div>
    </form>
  )
}
