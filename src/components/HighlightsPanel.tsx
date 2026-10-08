import { useEffect, useState } from 'react'
import { getCategory } from '../config/categories'
import { DATA_LABELS } from '../services/analysis/reliability'
import { settingsRepo } from '../services/data'
import { createHighlightStoryPng, highlightStoryFileName, highlightStoryPages, type HighlightStoryData, type HighlightStoryKind, type HighlightStoryRow } from '../services/image/highlightStory'
import type { HighlightSummary } from '../services/highlights/highlights'
import { byKickoffTime, HIGHLIGHT_OUTCOME_LABELS, highlightOutcome, REFUSAL_TEXTS, removalBlock, summarizeHighlights } from '../services/highlights/highlights'
import { useApp } from '../state/AppContext'
import { useNow } from '../state/useNow'
import { toAppDateTime } from '../utils/date'
import { formatDay, formatPlainDate } from '../utils/format'
import { formatScore } from '../utils/score'
import type { PickOutcome } from '../types'
import DatePicker from './DatePicker'

// Admin'in diğer ekranlarındaki sonuç rozetiyle aynı renkler; metin bu bölüme özgüdür.
const OUTCOME_TONE: Record<PickOutcome, string> = {
  won: 'border-win-line bg-win-soft text-win',
  lost: 'border-loss-line bg-loss-soft text-loss-text',
  void: 'border-navy-500 bg-navy-600 text-muted',
  pending: 'border-navy-500 bg-navy-600 text-muted',
}

/** "8 Eki 2026 09:41" (Türkiye saati); aynı günse yalnızca saat */
const addedText = (addedAt: string, day: string): string => {
  const at = toAppDateTime(new Date(addedAt))
  return at.date === day ? at.time : `${formatDay(at.date)} ${at.time}`
}

const STORY_BUTTON = 'rounded-xl px-3.5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50'
const STORY_KINDS: { kind: HighlightStoryKind; label: string }[] = [
  { kind: 'list', label: 'Günün Öne Çıkanları' },
  { kind: 'results', label: 'Öne Çıkanlar Sonuçları' },
]

/**
 * İki görsel: seçim listesi ve sonuçları. Mevcut Story altyapısıyla üretilir; yüzde ve güvenilirlik
 * yazılmaz. Paylaşılan kaydı oluşturmaz. 15'ten fazla seçim birden çok görsele bölünür.
 */
function StoryImages({ date, rows, summary }: { date: string; rows: HighlightStoryRow[]; summary: HighlightSummary }) {
  const [previews, setPreviews] = useState<{ kind: HighlightStoryKind; urls: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seçimler ya da sonuçlar değişince eski önizleme geçersizdir.
  const signature = JSON.stringify(rows)
  useEffect(() => setPreviews(null), [signature, date])
  useEffect(() => () => previews?.urls.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const produce = async (kind: HighlightStoryKind, download: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const texts = await settingsRepo.getStoryTexts()
      const pages: HighlightStoryData[] = highlightStoryPages(kind, formatPlainDate(date), rows, summary)
      const urls: string[] = []
      for (const page of pages) {
        const url = URL.createObjectURL(await createHighlightStoryPng(page, texts))
        urls.push(url)
        if (download) {
          const a = document.createElement('a')
          a.href = url
          a.download = highlightStoryFileName(page, date)
          a.click()
        }
      }
      setPreviews({ kind, urls })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Görsel oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  const pageCount = highlightStoryPages('list', '', rows, summary).length
  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="highlight-stories">
      <h3 className="text-sm font-extrabold tracking-wide">GÖRSELLER</h3>
      <p className="mt-1 text-xs text-muted">
        Görsellerde yüzde ve geçmiş veri etiketi yazmaz. Paylaşılan kaydı oluşturmaz.
        {pageCount > 1 && ` ${rows.length} seçim ${pageCount} görsele bölünür (1/${pageCount} …).`}
      </p>
      {summary.pending > 0 && (
        <p role="status" className="mt-2 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn" data-testid="highlight-story-pending">
          {summary.pending} bekleyen var; sonuç görselinde “Bekliyor” olarak görünür.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {STORY_KINDS.map(({ kind, label }) => (
          <div key={kind} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[11rem] text-sm font-semibold">{label}</span>
            <button type="button" onClick={() => void produce(kind, false)} disabled={busy || rows.length === 0} data-testid={`highlight-story-preview-${kind}`} className={`${STORY_BUTTON} border border-brand text-brand hover:bg-navy-600`}>
              Önizle
            </button>
            <button type="button" onClick={() => void produce(kind, true)} disabled={busy || rows.length === 0} data-testid={`highlight-story-download-${kind}`} className={`${STORY_BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}>
              PNG indir
            </button>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-loss-text">{error}</p>}
      {previews && (
        <div className="mt-3 flex flex-wrap gap-3" data-testid="highlight-story-previews" data-kind={previews.kind}>
          {previews.urls.map((url, i) => (
            <img key={url} src={url} alt={`${STORY_KINDS.find((k) => k.kind === previews.kind)!.label} görseli${previews.urls.length > 1 ? ` ${i + 1}/${previews.urls.length}` : ''}`} className="w-full max-w-[270px] rounded-xl border border-line" />
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-xl bg-navy-800 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-extrabold" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

/**
 * Seçili günün "öne çıkan" seçimleri ve yalnızca bu seçimlerin özeti. Sonuç, dondurulmuş
 * önerinin sonucudur (yoksa aynı değerlendirme fonksiyonu); burada yeni hesap yapılmaz.
 * Yalnızca admin sitesindedir: üye paketine ve üye sitesine girmez.
 */
export default function HighlightsPanel() {
  const { highlights, picks, results, matches, selectedDate, removeHighlight } = useApp()
  const now = useNow()
  const [refusal, setRefusal] = useState<string | null>(null)

  const rows = [...highlights].sort(byKickoffTime).map((record) => {
    const result = results[record.matchId]
    return {
      record,
      result,
      outcome: highlightOutcome(record, picks.find((p) => p.matchId === record.matchId && p.categoryId === record.categoryId), result),
      // Kilit kayıttan okunur (yayın anı, gün ve saat); maç verisi silinmiş olsa da değişmez.
      block: removalBlock(record, now),
      matchMissing: !matches.some((m) => m.id === record.matchId),
    }
  })
  const summary = summarizeHighlights(rows.map((row) => row.outcome))

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="highlights-panel">
      <h2 className="font-extrabold tracking-wide">GÜNÜN ÖNE ÇIKANLARI</h2>
      <p className="mt-1 text-sm text-muted">
        {selectedDate ? formatPlainDate(selectedDate) : 'Gün seçili değil'} · Kartlardaki “Öne çıkana ekle” ile seçilen öneriler. Maç başlayınca seçim kilitlenir: eklenemez ve kaldırılamaz; üyelere yayınlanan seçim de kaldırılamaz. Sonuç, skor girilince kendiliğinden gelir. Bu bir istatistik taramasıdır; bahis tavsiyesi değildir.
      </p>

      <div className="mt-3">
        <DatePicker />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="highlights-summary">
        <Figure label="Seçilen" value={summary.selected} testId="highlights-selected" />
        <Figure label="Tutan" value={summary.won} testId="highlights-won" />
        <Figure label="Tutmayan" value={summary.lost} testId="highlights-lost" />
        <Figure label="Bekleyen" value={summary.pending} testId="highlights-pending" />
      </div>
      {summary.void > 0 && (
        <p className="mt-2 text-xs text-muted" data-testid="highlights-void">
          Değerlendirilemeyen: {summary.void} (maç tamamlandı ama bu kategori için gereken veri girilmedi; tutan ve tutmayana girmez)
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Sayılar yalnızca bu bölümdeki seçimlerden hesaplanır. Kilitlenmeden önce kaldırılan seçim silinir ve sayılmaz.</p>

      {refusal && (
        <p className="mt-2 text-xs font-semibold text-loss-text" data-testid="highlights-refusal">
          {refusal}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-navy-600 px-3 py-2.5 text-sm text-muted" data-testid="highlights-empty">
          Bu gün için seçim yok.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line" data-testid="highlights-list">
          {rows.map(({ record, result, outcome, block, matchMissing }) => {
            const score = formatScore(result)
            return (
              <li key={record.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 py-2.5" data-testid="highlight-row" data-outcome={outcome} data-locked={block !== null} data-lock-reason={block ?? undefined}>
                <div className="min-w-0">
                  <p className="text-sm leading-snug font-bold break-words">
                    <span className="mr-1.5 font-semibold text-muted">{record.time}</span>
                    {record.home} <span className="text-muted">–</span> {record.away}
                  </p>
                  <p className="mt-0.5 text-[11px] break-words text-muted">
                    <span className="font-bold text-brand">{getCategory(record.categoryId).label}</span>
                    {' · '}eklenirken %{record.percent}
                    {record.reliability && ` · geçmiş veri: ${DATA_LABELS[record.reliability]}`}
                    {record.league && ` · ${record.league}`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Eklendi: {addedText(record.addedAt, record.date)} (TSİ)
                    {record.publishedAt && ` · Yayınlandı: ${addedText(record.publishedAt, record.date)}`}
                    {matchMissing && <span className="font-semibold text-warn"> · maç verisi silinmiş; kayıttan gösteriliyor</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {score && <span className="text-xs font-bold whitespace-nowrap">{score}</span>}
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${OUTCOME_TONE[outcome]}`} data-testid="highlight-outcome" data-outcome={outcome}>
                    {HIGHLIGHT_OUTCOME_LABELS[outcome]}
                  </span>
                  {block ? (
                    <span className="rounded-full border border-navy-500 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-muted" title={block === 'published' ? REFUSAL_TEXTS.published : 'Maç başladı; seçim kilitli, kaldırılamaz.'} data-testid="highlight-lock">
                      {block === 'published' ? '🔒 Yayınlandı' : '🔒 Kilitli'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void removeHighlight(record.id).then((reason) => setRefusal(reason ? REFUSAL_TEXTS[reason] : null))}
                      data-testid="highlight-remove"
                      className="rounded-full border border-navy-500 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap hover:bg-navy-600"
                    >
                      Kaldır
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {selectedDate && (
        <StoryImages
          date={selectedDate}
          rows={rows.map(({ record, result, outcome }) => ({ home: record.home, away: record.away, time: record.time, categoryLabel: getCategory(record.categoryId).label, score: formatScore(result), outcome }))}
          summary={summary}
        />
      )}
    </section>
  )
}
