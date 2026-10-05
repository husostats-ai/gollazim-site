import { useEffect, useState } from 'react'
import { getCategory } from '../config/categories'
import { analyzeCategory } from '../services/analysis/engine'
import type { CategoryAnalysis } from '../services/analysis/types'
import { createStoryPng, storyFromAnalysis } from '../services/image/storyGenerator'
import { STORY } from '../services/image/storyLayout'
import { useApp } from '../state/AppContext'
import { formatLongDate } from '../utils/format'

/** Görsel üretilememesinin nedeni; üretilebiliyorsa null */
const disabledReason = (analysis: CategoryAnalysis, totalMatches: number): string | null => {
  if (analysis.predictions.length > 0) return null
  if (totalMatches === 0) return 'Bu tarih için maç verisi yok.'
  if (analysis.evaluatedCount === 0) return 'Gerekli istatistik CSV’de bulunamadı.'
  return `Eşiği (%${analysis.threshold}) geçen maç yok.`
}

export default function StoryButton({ categoryId }: { categoryId: CategoryAnalysis['categoryId'] }) {
  const { matches, thresholds, selectedDate } = useApp()
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const category = getCategory(categoryId)
  // Görseldeki sıra her zaman yüzdeye göredir; temkinli sıra görseli etkilemez.
  const analysis = analyzeCategory(matches, categoryId, thresholds[categoryId], 'percent')
  const reason = disabledReason(analysis, matches.length)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview])

  const onCreate = async () => {
    if (!selectedDate) return
    setBusy(true)
    setError(null)
    try {
      const blob = await createStoryPng(storyFromAnalysis(analysis, formatLongDate(selectedDate)))
      setPreview({ url: URL.createObjectURL(blob), fileName: `gollazim-${category.slug}-${selectedDate}.png` })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {(reason || error) && (
          <span className="text-[11px] text-muted" data-testid="story-reason">
            {error ?? reason}
          </span>
        )}
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || reason !== null}
          data-testid={`story-${categoryId}`}
          className="rounded-lg border border-brand px-3 py-1.5 text-xs font-bold whitespace-nowrap text-brand hover:bg-navy-600 disabled:cursor-not-allowed disabled:border-navy-500 disabled:text-muted disabled:hover:bg-transparent"
        >
          {busy ? 'Hazırlanıyor…' : 'Görsel oluştur'}
        </button>
      </span>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${category.label} story görseli`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-navy-950 p-4"
        >
          <img
            src={preview.url}
            alt={`Günün ${category.label} önerileri`}
            width={STORY.width}
            height={STORY.height}
            className="max-h-[78vh] w-auto rounded-xl border border-navy-600"
          />
          <p className="text-xs text-muted">
            {STORY.width} × {STORY.height} piksel · Instagram Story
          </p>
          <div className="flex gap-2">
            <a
              href={preview.url}
              download={preview.fileName}
              data-testid="story-download"
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-navy-950 hover:bg-brand-dark"
            >
              PNG indir
            </a>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-xl border border-navy-500 px-5 py-2.5 text-sm font-bold"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </>
  )
}
