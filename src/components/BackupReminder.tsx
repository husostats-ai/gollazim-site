import { useState } from 'react'
import type { BackupLevel } from '../services/daily/checklist'
import { downloadBackup } from '../services/data/backupFile'
import { useApp } from '../state/AppContext'
import type { DailyStatus } from '../state/useDailyStatus'

const TONE: Record<Exclude<BackupLevel, 'none'>, { box: string; icon: string; label: string }> = {
  ok: { box: 'border-win-line bg-win-soft text-win', icon: '✓', label: 'Yedek güncel' },
  warn: { box: 'border-warn-line bg-warn-soft text-warn', icon: '!', label: 'Dikkat' },
  alert: { box: 'border-loss-line bg-loss-soft text-loss-text', icon: '⚠', label: 'Uyarı' },
  never: { box: 'border-loss-line bg-loss-soft text-loss-text', icon: '⚠', label: 'Uyarı' },
}

/** Son yedeğin ne zaman alındığını hatırlatan bant; hiç veri yoksa görünmez. */
export default function BackupReminder({ status }: { status: DailyStatus | null }) {
  const { refresh } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!status) return null
  const { backup, since } = status
  const level = backup.level
  if (level === 'none') return null
  const tone = TONE[level]

  const onBackup = async () => {
    setBusy(true)
    setError(null)
    try {
      await downloadBackup()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yedek alınamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="status" data-testid="backup-reminder" data-level={backup.level} className={`mb-4 min-w-0 rounded-2xl border p-3 ${tone.box}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 text-sm font-bold">
          <span aria-hidden="true">{tone.icon} </span>
          <span className="uppercase">{tone.label}:</span> <span data-testid="backup-text">{backup.text}</span>
        </p>
        <button
          type="button"
          onClick={() => void onBackup()}
          disabled={busy}
          data-testid="backup-now"
          className="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? 'Hazırlanıyor…' : 'Yedek al'}
        </button>
      </div>
      {since && (
        <p className="mt-1.5 text-xs text-white" data-testid="backup-since">
          Yedekten sonra {since.scores} skor girişi / {since.uploads} CSV
        </p>
      )}
      <p className="mt-1 text-xs text-muted">Dosya indirilenler klasörüne iner; güvenli bir yere (bulut / harici disk) kopyala.</p>
      {error && <p className="mt-1 text-xs text-loss-text">{error}</p>}
    </div>
  )
}
