import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ensurePersistence, restoreBackup, saveBackup, SAVE_OUTCOME_TEXT } from '../services/data/backupFile'
import { PERSISTENCE_LABELS, PERSISTENCE_NOTE, type PersistenceStatus } from '../services/data/backupFlow'
import { useApp } from '../state/AppContext'

type Status = { kind: 'ok' | 'info' | 'error'; text: string } | null

const STATUS_TONE = { ok: 'text-win', info: 'text-muted', error: 'text-loss' } as const

export default function BackupPanel() {
  const { refresh } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensurePersistence().then((value) => !cancelled && setPersistence(value))
    return () => {
      cancelled = true
    }
  }, [])

  const run = async (action: () => Promise<Exclude<Status, null>>) => {
    setBusy(true)
    setStatus(null)
    try {
      setStatus(await action())
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu.' })
    } finally {
      setBusy(false)
    }
  }

  const onExport = () =>
    run(async () => {
      const outcome = await saveBackup()
      await refresh()
      return { kind: outcome === 'cancelled' ? 'info' : 'ok', text: SAVE_OUTCOME_TEXT[outcome] }
    })

  const onImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      const outcome = await restoreBackup(file)
      if (outcome.kind === 'cancelled') return { kind: 'info', text: outcome.reason }
      await refresh()
      const safety = outcome.safety === 'skipped' ? '' : ' Önceki verinin güvenlik yedeği kaydedildi.'
      return { kind: 'ok', text: `Yedek yüklendi: ${outcome.backup.matches.length} maç, ${outcome.backup.results.length} skor.${safety}` }
    })
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">VERİ YEDEĞİ</h2>
      <p className="mt-1 text-sm text-muted">
        Veriler bu tarayıcıda saklanır. Tarayıcı verisi silinirse kaybolmaması için düzenli yedek alın.
      </p>
      <p className="mt-2 text-sm" data-testid="storage-persistence" data-status={persistence ?? 'pending'}>
        <span className="font-semibold">Kalıcı depo:</span> {persistence ? PERSISTENCE_LABELS[persistence] : 'denetleniyor…'}
        <span className="block text-xs text-muted">{PERSISTENCE_NOTE}</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-50"
        >
          Veriyi dışa aktar (JSON)
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-xl border border-navy-500 px-4 py-2.5 text-sm font-bold hover:bg-navy-600 disabled:opacity-50"
        >
          Veriyi içe aktar (JSON)
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onImport} />
      </div>
      {status && <p className={`mt-3 text-sm ${STATUS_TONE[status.kind]}`}>{status.text}</p>}
    </section>
  )
}
