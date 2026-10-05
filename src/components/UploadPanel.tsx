import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CATEGORIES } from '../config/categories'
import { CALCULATORS } from '../services/analysis/calculators'
import { uploadCsvFile, type UploadSummary } from '../services/csv/uploadService'
import { uploadsRepo } from '../services/data'
import { useApp } from '../state/AppContext'
import type { Upload } from '../types'
import { formatLongDate } from '../utils/format'

const uploadedAtFmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })

/** Eksik kolonlar yüzünden hesaplanamayacak kategoriler */
const affectedCategories = (summary: UploadSummary): string[] =>
  CATEGORIES.filter((c) => CALCULATORS[c.id].requiredFields.some((f) => summary.missingFields.includes(f))).map(
    (c) => c.label,
  )

export default function UploadPanel() {
  const { refresh, selectDate, dataVersion } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<UploadSummary | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const loadUploads = async () => setUploads(await uploadsRepo.list())
  // Maç silme gibi başka panellerden gelen değişikliklerde de liste yenilenir.
  useEffect(() => {
    void loadUploads()
  }, [dataVersion])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const result = await uploadCsvFile(file)
      setSummary(result)
      await loadUploads()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV yüklenirken beklenmeyen bir hata oluştu.')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    setBusy(true)
    try {
      await uploadsRepo.remove(id)
      setConfirmDelete(null)
      setSummary(null)
      await loadUploads()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const affected = summary ? affectedCategories(summary) : []

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">CSV YÜKLE</h2>
      <p className="mt-1 text-sm text-muted">
        Günlük FootyStats CSV dosyasını seçin; maçlar okunur ve kategorilere otomatik yerleştirilir. Aynı maç
        tekrar yüklenirse kopya oluşmaz, kayıt güncellenir.
      </p>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-50"
      >
        {busy ? 'İşleniyor…' : 'CSV dosyası seç'}
      </button>
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={onFile} data-testid="csv-input" />

      {error && (
        <p className="mt-3 rounded-xl border border-loss-line bg-loss-soft px-3 py-2 text-sm text-loss-text">{error}</p>
      )}

      {summary && (
        <div className="mt-3 rounded-xl border border-win-line bg-win-soft px-3 py-2 text-sm">
          <p className="font-bold wrap-anywhere text-win">
            {summary.upload.fileName}: {summary.added} yeni maç eklendi, {summary.updated} maç güncellendi.
            {summary.preserved > 0 && ` ${summary.preserved} düzenlenmiş maç korundu.`}
          </p>
          <p className="mt-1 text-muted">
            Tarihler:{' '}
            {summary.dates.map((d, i) => (
              <span key={d}>
                {i > 0 && ', '}
                <button type="button" className="text-white underline" onClick={() => selectDate(d)}>
                  {formatLongDate(d)}
                </button>
              </span>
            ))}
          </p>
          {affected.length > 0 && (
            <p className="mt-1 text-warn">
              Gerekli kolon CSV’de bulunamadığı için hesaplanamayacak kategoriler: {affected.join(', ')}.
            </p>
          )}
          {summary.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-warn">
              {summary.warnings.slice(0, 10).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {summary.warnings.length > 10 && <li>… ve {summary.warnings.length - 10} uyarı daha</li>}
            </ul>
          )}
        </div>
      )}

      <h3 className="mt-6 text-sm font-extrabold tracking-wide">YÜKLENEN DOSYALAR</h3>
      {uploads.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Henüz dosya yüklenmedi.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {uploads.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold break-all">{u.fileName}</p>
                <p className="text-xs text-muted">
                  {uploadedAtFmt.format(new Date(u.uploadedAt))} · {u.matchCount} maç
                </p>
              </div>
              {confirmDelete === u.id ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">Maçlar ve skorları silinsin mi?</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(u.id)}
                    className="rounded-lg bg-loss px-3 py-1.5 font-bold text-white disabled:opacity-50"
                  >
                    Evet, sil
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="rounded-lg border border-navy-500 px-3 py-1.5 font-bold"
                  >
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(u.id)}
                  data-testid="upload-delete"
                  className="rounded-lg border border-loss-line px-3 py-1.5 text-xs font-bold text-loss-text hover:bg-loss-soft"
                >
                  Sil
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
