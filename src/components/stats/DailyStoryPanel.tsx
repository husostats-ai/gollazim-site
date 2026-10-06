import { useEffect, useMemo, useState } from 'react'
import { analyzeDay } from '../../services/analysis/engine'
import { matchesRepo, resultsRepo, settingsRepo } from '../../services/data'
import { createDailyStoryPng, dailyStoryFileName } from '../../services/image/dailyStory'
import { STORY } from '../../services/image/storyLayout'
import {
  buildDailySummary,
  countUnsettledMatches,
  DAILY_CATEGORY_IDS,
  latestDecidedDate,
} from '../../services/stats/dailySummary'
import { useApp } from '../../state/AppContext'
import type { Pick } from '../../types'
import { formatDay, formatPlainDate } from '../../utils/format'

const BUTTON = 'rounded-xl px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60'

/** Seçilen günün başarı özetini Story görseli olarak önizler ve indirir. */
export default function DailyStoryPanel({ picks }: { picks: Pick[] }) {
  const { dates: matchDates, thresholds, dataVersion } = useApp()
  const [chosen, setChosen] = useState<string | null>(null)
  const [unsettled, setUnsettled] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Maç verisi ya da dondurulmuş önerisi olan günler, yeniden eskiye.
  const dates = useMemo(
    () => [...new Set([...matchDates, ...picks.map((p) => p.date)])].sort().reverse(),
    [matchDates, picks],
  )
  const date = chosen && dates.includes(chosen) ? chosen : (latestDecidedDate(picks) ?? dates[0] ?? null)
  const summary = useMemo(() => (date ? buildDailySummary(picks, date) : null), [picks, date])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    void (async () => {
      const matches = await matchesRepo.listByDate(date)
      const results = await resultsRepo.listByMatchIds(matches.map((m) => m.id))
      if (cancelled) return
      const analysis = analyzeDay(matches, thresholds, 'percent')
      const recommended = DAILY_CATEGORY_IDS.flatMap((id) => analysis[id].predictions.map((p) => p.match.id))
      setUnsettled(countUnsettledMatches(picks, date, recommended, Object.fromEntries(results.map((r) => [r.matchId, r]))))
    })()
    return () => {
      cancelled = true
    }
  }, [date, picks, thresholds, dataVersion])

  // Gün ya da veri değişince eski önizleme geçersizdir.
  useEffect(() => setPreview(null), [summary])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  if (!date || !summary) return <p className="text-sm text-muted">Henüz maç verisi yok.</p>

  const run = async (use: (url: string) => void) => {
    setBusy(true)
    setError(null)
    try {
      // Alt metinler her üretimde ayarlardan okunur; Admin'de yapılan değişiklik hemen yansır.
      const texts = await settingsRepo.getStoryTexts()
      use(URL.createObjectURL(await createDailyStoryPng(summary, formatPlainDate(date), texts)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  const onDownload = () =>
    run((url) => {
      const a = document.createElement('a')
      a.href = url
      a.download = dailyStoryFileName(date)
      a.click()
      setPreview(url)
    })

  return (
    <div className="min-w-0">
      <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        Gün
        <select
          value={date}
          onChange={(e) => setChosen(e.target.value)}
          data-testid="daily-date"
          className="max-w-full rounded-xl border border-navy-600 bg-navy-800 px-3 py-2 text-sm font-bold text-white"
        >
          {dates.map((d) => (
            <option key={d} value={d}>
              {formatDay(d)}
            </option>
          ))}
        </select>
      </label>

      {unsettled > 0 && (
        <p
          role="status"
          data-testid="daily-unsettled"
          className="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          {unsettled} maç henüz sonuçlanmadı, görsel eksik veriyle üretilir
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(setPreview)}
          disabled={busy}
          data-testid="daily-preview"
          className={`${BUTTON} border border-brand text-brand hover:bg-navy-600`}
        >
          Önizle
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          data-testid="daily-download"
          className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}
        >
          PNG indir
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-loss-text">{error}</p>}

      {preview && (
        <div className="mt-4">
          <img
            src={preview}
            alt={`${formatPlainDate(date)} günlük başarı görseli`}
            width={STORY.width}
            height={STORY.height}
            data-testid="daily-image"
            className="h-auto w-full max-w-[270px] rounded-xl border border-navy-600"
          />
          <p className="mt-1 text-xs text-muted">
            {STORY.width} × {STORY.height} piksel · Instagram Story
          </p>
        </div>
      )}
    </div>
  )
}
