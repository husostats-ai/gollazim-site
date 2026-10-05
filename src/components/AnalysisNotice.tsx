import { FIELD_LABELS } from '../config/columnAliases'
import type { CategoryAnalysis } from '../services/analysis/types'
import EmptyState from './EmptyState'

const missingText = (analysis: CategoryAnalysis) =>
  analysis.missingFields.map((f) => FIELD_LABELS[f]).join(', ')

/** Liste boşsa nedenini açıklar; hiçbir durumda yerine veri uydurulmaz. */
export function EmptyAnalysis({ analysis, total }: { analysis: CategoryAnalysis; total: number }) {
  if (total === 0) return <EmptyState>Bu tarih için maç verisi yok.</EmptyState>
  if (analysis.evaluatedCount === 0) {
    return (
      <EmptyState>
        Bu analiz için gerekli istatistik CSV içerisinde bulunamadı.
        <span className="mt-1 block text-xs">Eksik: {missingText(analysis)}</span>
      </EmptyState>
    )
  }
  return <EmptyState>Eşiği (%{analysis.threshold}) geçen maç yok.</EmptyState>
}

/** Bazı maçlar veri eksikliğinden değerlendirilemediyse kısa not */
export function UnavailableNote({ analysis }: { analysis: CategoryAnalysis }) {
  if (analysis.unavailableCount === 0 || analysis.evaluatedCount === 0) return null
  return (
    <p className="mt-3 text-xs text-muted">
      {analysis.unavailableCount} maç, gerekli istatistik ({missingText(analysis)}) CSV’de olmadığı için
      değerlendirilemedi.
    </p>
  )
}
