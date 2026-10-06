import { useEffect, useState } from 'react'
import { getCategory } from '../config/categories'
import type { CategoryAnalysis } from '../services/analysis/types'
import { createStoryPng, storyFromAnalysis } from '../services/image/storyGenerator'
import { STORY } from '../services/image/storyLayout'
import { resolveSelection } from '../services/story/selection'
import { downloadStory, previewStory, type DownloadResult, type StoryPreview } from '../services/story/storyFlow'
import { useApp } from '../state/AppContext'
import { LATE_SHARE_NOTE } from './SharedBadge'
import { formatLongDate } from '../utils/format'

const lateText = (count: number): string =>
  count === 1 ? LATE_SHARE_NOTE : `${count} maç başladıktan sonra paylaşıldı olarak işaretlendi`

export const PREVIEW_NOTE = 'Önizleme kaydetmez; indirince bu maçlar paylaşıldı olarak kaydedilir.'

export const SELECT_FIRST = 'Önce görsele girecek maçları seç'

/** Görsel üretilememesinin nedeni; üretilebiliyorsa null */
const disabledReason = (analysis: CategoryAnalysis, totalMatches: number, selectedCount: number): string | null => {
  if (analysis.predictions.length > 0) return selectedCount > 0 ? null : SELECT_FIRST
  if (totalMatches === 0) return 'Bu tarih için maç verisi yok.'
  if (analysis.evaluatedCount === 0) return 'Gerekli istatistik CSV’de bulunamadı.'
  return `Eşiği (%${analysis.threshold}) geçen maç yok.`
}

export default function StoryButton({ categoryId }: { categoryId: CategoryAnalysis['categoryId'] }) {
  const { matches, analysis: dayAnalysis, storySelections, selectedDate, recordShared } = useApp()
  const [preview, setPreview] = useState<{ url: string; fileName: string; story: StoryPreview } | null>(null)
  /** Açık önizlemenin indirme sonucu; indirilmediyse null */
  const [saved, setSaved] = useState<DownloadResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Son indirmede, başladıktan sonra paylaşıldı olarak işaretlenen maç sayısı */
  const [late, setLate] = useState(0)

  const category = getCategory(categoryId)
  const analysis = dayAnalysis[categoryId]
  // Görsele yalnızca işaretlenen maçlar girer. Sıra her zaman yüzdeye göredir; temkinli sıra görseli etkilemez.
  const { selected, missing } = resolveSelection(analysis.predictions, storySelections[categoryId])
  const reason = disabledReason(analysis, matches.length, selected.length)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview])

  const onCreate = async () => {
    if (!selectedDate) return
    setBusy(true)
    setError(null)
    try {
      // Önizleme hiçbir kayıt oluşturmaz; paylaşıldı kaydı yalnızca indirme anında açılır.
      const story = await previewStory(
        { render: () => createStoryPng(storyFromAnalysis({ ...analysis, predictions: selected }, formatLongDate(selectedDate))) },
        selected.map((p) => p.match),
      )
      setSaved(null)
      setPreview({ url: URL.createObjectURL(story.blob), fileName: `gollazim-${category.slug}-${selectedDate}.png`, story })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  // Bağlantı dosyayı indirir (varsayılan davranış engellenmez); aynı anda görseldeki maçlar kaydedilir.
  const onDownload = async () => {
    if (!preview) return
    try {
      const result = await downloadStory({ record: (shared) => recordShared(categoryId, shared) }, preview.story)
      setSaved(result)
      setLate(result.late)
    } catch {
      setError('Görsel indirildi ama paylaşıldı kaydı yazılamadı.')
    }
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {late > 0 && (
          <span className="text-[11px] text-warn" data-testid="story-late">
            {lateText(late)}
          </span>
        )}
        {missing > 0 && (
          <span className="text-[11px] text-warn" data-testid="story-missing">
            {missing} seçili maç artık listede değil
          </span>
        )}
        {(reason || error) && (
          <span className="text-[11px] text-muted" data-testid="story-reason">
            {error ?? reason}
          </span>
        )}
        {selected.length > 0 && (
          <span className="text-[11px] font-bold whitespace-nowrap" data-testid="story-count">
            {selected.length} maç seçili
          </span>
        )}
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || reason !== null}
          data-testid={`story-${categoryId}`}
          className="rounded-lg border border-brand px-3 py-1.5 text-xs font-bold whitespace-nowrap text-brand hover:bg-navy-600 disabled:cursor-not-allowed disabled:border-navy-500 disabled:text-muted disabled:hover:bg-transparent"
        >
          {busy ? 'Hazırlanıyor…' : 'Görseli önizle'}
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
            className="max-h-[68vh] w-auto rounded-xl border border-navy-600"
          />
          <p className="text-center text-xs text-muted">
            ÖNİZLEME · {STORY.width} × {STORY.height} piksel · Instagram Story
          </p>
          {saved ? (
            <p className="text-center text-xs text-win" data-testid="story-saved">
              İndirildi; görseldeki {preview.story.matches.length} maç paylaşıldı olarak kayıtlı
              {saved.added > 0 ? ` (${saved.added} yeni kayıt).` : ' (yeni kayıt yok, hepsi zaten kayıtlıydı).'}
            </p>
          ) : (
            <p className="text-center text-xs text-muted" data-testid="story-preview-note">
              {PREVIEW_NOTE}
            </p>
          )}
          {saved && saved.late > 0 && <p className="text-center text-xs text-warn">{lateText(saved.late)}</p>}
          {error && <p className="text-center text-xs text-loss-text">{error}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            <a
              href={preview.url}
              download={preview.fileName}
              onClick={() => void onDownload()}
              data-testid="story-download"
              className="rounded-xl bg-brand px-5 py-2.5 text-center text-sm font-bold text-navy-950 hover:bg-brand-dark"
            >
              İndir ve paylaşıldı olarak kaydet
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
