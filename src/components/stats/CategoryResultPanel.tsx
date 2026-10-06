import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, getCategory, type CategoryId } from '../../config/categories'
import { analyzeDay } from '../../services/analysis/engine'
import { matchesRepo, resultsRepo, settingsRepo } from '../../services/data'
import { createResultStoryPng, resultStoryFileName, resultSummaryText } from '../../services/image/resultStory'
import { STORY } from '../../services/image/storyLayout'
import { buildCategoryResult } from '../../services/stats/categoryResult'
import { buildResultCaption, type CaptionTarget } from '../../services/story/caption'
import { activeShared, SCOPE_LABELS, type StatsScope } from '../../services/story/shared'
import { useApp } from '../../state/AppContext'
import type { Match, MatchResult, Pick, SharedPick } from '../../types'
import type { StoryTexts } from '../../config/storyTexts'
import { formatPlainDate } from '../../utils/format'
import CaptionBox from '../CaptionBox'

const BUTTON = 'rounded-xl px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60'

interface DayData {
  matches: Match[]
  results: Record<string, MatchResult>
}

/**
 * Seçilen günün tek bir kategorideki sonuçlarını Story görseli ve metin olarak üretir.
 * Paylaşılan kaydı oluşturmaz ve değiştirmez.
 */
export default function CategoryResultPanel({ date, picks, shared }: { date: string; picks: Pick[]; shared: SharedPick[] }) {
  const { thresholds, dataVersion } = useApp()
  const [categoryId, setCategoryId] = useState<CategoryId>(CATEGORIES[0].id)
  const [chosenScope, setChosenScope] = useState<StatsScope | null>(null)
  const [day, setDay] = useState<DayData | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [captionTexts, setCaptionTexts] = useState<StoryTexts | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDay(null)
    void (async () => {
      const matches = await matchesRepo.listByDate(date)
      const results = await resultsRepo.listByMatchIds(matches.map((m) => m.id))
      if (!cancelled) setDay({ matches, results: Object.fromEntries(results.map((r) => [r.matchId, r])) })
    })()
    return () => {
      cancelled = true
    }
  }, [date, dataVersion])

  // Gün ya da kategori değişince ölçü varsayılana döner.
  useEffect(() => setChosenScope(null), [date, categoryId])

  const hasShared = useMemo(
    () => activeShared(shared).some((r) => r.date === date && r.categoryId === categoryId),
    [shared, date, categoryId],
  )
  const scope: StatsScope = chosenScope ?? (hasShared ? 'shared' : 'all')
  const result = useMemo(() => {
    if (!day) return null
    // "Tüm öneriler"de, şu an listede olup skoru girilmemiş maçlar da "Bekliyor" olarak görünür.
    const recommended = analyzeDay(day.matches, thresholds, 'percent')[categoryId].predictions.map((p) => p.match.id)
    return buildCategoryResult({ date, categoryId, scope, picks, shared, matches: day.matches, results: day.results, recommendedIds: recommended })
  }, [day, date, categoryId, scope, picks, shared, thresholds])

  // Veri değişince eski önizleme geçersizdir.
  useEffect(() => setPreview(null), [result])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  if (!result) return null
  const category = getCategory(categoryId)
  const dateLabel = formatPlainDate(date)

  const run = async (use: (url: string) => void) => {
    setBusy(true)
    setError(null)
    try {
      const texts = await settingsRepo.getStoryTexts()
      use(URL.createObjectURL(await createResultStoryPng(result, dateLabel, texts)))
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
      a.download = resultStoryFileName(category.slug, date)
      a.click()
      setPreview(url)
    })
  const caption = (target: CaptionTarget) => (captionTexts ? buildResultCaption({ target, result, dateLabel, texts: captionTexts }) : '')

  return (
    <div className="mt-6 min-w-0 border-t border-line pt-4" data-testid="category-result">
      <h3 className="text-sm font-extrabold tracking-wide">KATEGORİ SONUÇ GÖRSELİ</h3>
      <p className="mt-1 text-xs text-muted">
        Yukarıda seçilen günün tek bir kategorideki maçları, skorları ve sonuçları. Bu görsel paylaşılan kaydı
        oluşturmaz ve değiştirmez.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex max-w-full min-w-0 items-center gap-2 text-sm font-semibold">
          Kategori
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value as CategoryId)}
            data-testid="result-category"
            className="min-w-0 flex-1 rounded-xl border border-navy-600 bg-navy-800 px-3 py-2 text-sm font-bold text-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Ölçü">
          {(['shared', 'all'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={scope === id}
              onClick={() => setChosenScope(id)}
              data-testid={`result-scope-${id}`}
              className={`rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
                scope === id ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
              }`}
            >
              {SCOPE_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm" data-testid="result-summary">
        <span className="font-extrabold">{resultSummaryText(result.tally)}</span>
        <span className="text-muted">
          {' '}
          · {result.rows.length} maç{scope === 'shared' && !hasShared ? ' · bu kategoride paylaşılan öneri kaydı yok' : ''}
        </span>
      </p>

      {result.unsettled > 0 && (
        <p role="status" data-testid="result-unsettled" className="mt-3 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          {result.unsettled} maç henüz sonuçlanmadı, görsel eksik veriyle üretilir
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => run(setPreview)} disabled={busy} data-testid="result-preview" className={`${BUTTON} border border-brand text-brand hover:bg-navy-600`}>
          Önizle
        </button>
        <button type="button" onClick={onDownload} disabled={busy} data-testid="result-download" className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}>
          PNG indir
        </button>
        <button
          type="button"
          onClick={async () => setCaptionTexts(captionTexts ? null : await settingsRepo.getStoryTexts())}
          disabled={result.rows.length === 0}
          aria-expanded={captionTexts !== null}
          data-testid="result-caption"
          className={`${BUTTON} border border-navy-500 hover:bg-navy-600`}
        >
          Sonuç metni
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-loss-text">{error}</p>}

      {captionTexts && result.rows.length > 0 && (
        <div className="mt-3">
          <CaptionBox instagram={caption('instagram')} telegram={caption('telegram')} testId="result-caption" />
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <img
            src={preview}
            alt={`${dateLabel} ${category.label} sonuç görseli`}
            width={STORY.width}
            height={STORY.height}
            data-testid="result-image"
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
