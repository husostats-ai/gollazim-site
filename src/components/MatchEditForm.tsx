import { useState, type FormEvent } from 'react'
import { FIELD_LABELS } from '../config/columnAliases'
import { EDITABLE_STATS } from '../config/editableStats'
import { syncUploadCounts } from '../services/csv/uploadService'
import { movePicksToDate } from '../services/results/resultService'
import { parseNumber } from '../services/csv/values'
import { matchesRepo, streakRepo } from '../services/data'
import type { Match, StatValue } from '../types'

interface Props {
  match: Match
  onDone: () => void
  onCancel: () => void
}

const inputClass =
  'w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm outline-none focus:border-brand'

const statText = (value: StatValue | undefined): string =>
  typeof value === 'number' ? String(value).replace('.', ',') : ''

export default function MatchEditForm({ match, onDone, onCancel }: Props) {
  const [home, setHome] = useState(match.home)
  const [away, setAway] = useState(match.away)
  const [league, setLeague] = useState(match.league ?? '')
  const [date, setDate] = useState(match.date)
  const [time, setTime] = useState(match.time ?? '')
  const [stats, setStats] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE_STATS.map(({ field }) => [field, statText(match.stats[field])])),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!home.trim() || !away.trim()) return setError('Takım adları boş olamaz.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Geçerli bir tarih girin.')

    const nextStats: Record<string, StatValue> = { ...match.stats }
    for (const { field, percent } of EDITABLE_STATS) {
      const text = stats[field].trim()
      // Boş bırakılan alan "veri yok" olur; o maç ilgili analizde değerlendirilmez.
      const value = text === '' ? null : parseNumber(text)
      if (text !== '' && (value === null || value < 0 || (percent && value > 100))) {
        return setError(`${FIELD_LABELS[field]}: ${percent ? '0-100 arası' : 'sıfır veya pozitif'} bir sayı girin.`)
      }
      nextStats[field] = value
    }

    setBusy(true)
    await matchesRepo.update(match.id, {
      home: home.trim(),
      away: away.trim(),
      league: league.trim() || undefined,
      date,
      time: time || undefined,
      stats: nextStats,
      edited: true,
    })
    if (date !== match.date) await movePicksToDate(match.id, date)
    // Seri takibindeki adımın günü ve saati maçla birlikte güncellenir (ertelenen maç).
    await streakRepo.syncSchedule(match.id, { date, time: time || null })
    onDone()
  }

  const onDelete = async () => {
    setBusy(true)
    await matchesRepo.remove(match.id)
    await syncUploadCounts()
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 rounded-xl border border-navy-500 bg-navy-800 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Ev sahibi
          <input className={inputClass} value={home} onChange={(e) => setHome(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Deplasman
          <input className={inputClass} value={away} onChange={(e) => setAway(e.target.value)} />
        </label>
        <label className="text-xs text-muted sm:col-span-2">
          Lig
          <input className={inputClass} value={league} onChange={(e) => setLeague(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Tarih
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Saat
          <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <div>
        <p className="text-xs font-bold tracking-wide">İSTATİSTİKLER</p>
        <p className="text-xs text-muted">Boş bırakılan alan “veri yok” sayılır.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {EDITABLE_STATS.map(({ field }) => (
            <label key={field} className="text-xs text-muted">
              {FIELD_LABELS[field]}
              <input
                className={inputClass}
                inputMode="decimal"
                value={stats[field]}
                onChange={(e) => setStats((s) => ({ ...s, [field]: e.target.value }))}
                data-field={field}
              />
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-loss-text">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-50"
          >
            Kaydet
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-navy-500 px-4 py-2 text-sm font-bold">
            Vazgeç
          </button>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">Maç ve skoru silinsin mi?</span>
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
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-loss-line px-3 py-1.5 text-xs font-bold text-loss-text hover:bg-loss-soft"
          >
            Maçı sil
          </button>
        )}
      </div>
    </form>
  )
}
