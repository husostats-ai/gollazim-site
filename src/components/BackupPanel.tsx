import { useRef, useState, type ChangeEvent } from 'react'
import { downloadBackup, restoreBackup } from '../services/data/backupFile'
import { useApp } from '../state/AppContext'

type Status = { kind: 'ok' | 'error'; text: string } | null

export default function BackupPanel() {
  const { refresh } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ kind: 'ok', text: await action() })
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu.' })
    } finally {
      setBusy(false)
    }
  }

  const onExport = () =>
    run(async () => {
      await downloadBackup()
      return 'Yedek dosyası indirildi.'
    })

  const onImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!window.confirm('Tarayıcıdaki mevcut verinin tamamı bu yedekle değiştirilecek. Devam edilsin mi?')) return
    run(async () => {
      const backup = await restoreBackup(file)
      await refresh()
      return `Yedek yüklendi: ${backup.matches.length} maç, ${backup.results.length} skor.`
    })
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">VERİ YEDEĞİ</h2>
      <p className="mt-1 text-sm text-muted">
        Veriler bu tarayıcıda saklanır. Tarayıcı verisi silinirse kaybolmaması için düzenli yedek alın.
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
      {status && (
        <p className={`mt-3 text-sm ${status.kind === 'ok' ? 'text-win' : 'text-loss'}`}>{status.text}</p>
      )}
    </section>
  )
}
