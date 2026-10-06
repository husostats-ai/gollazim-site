import { useState } from 'react'
import type { SharedPick } from '../types'

export const LATE_SHARE_NOTE = 'Bu maç başladıktan sonra paylaşıldı olarak işaretlendi'

const sharedAtFmt = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' })

/** "Paylaşıldı" rozeti ve onay isteyen "Paylaşılandan çıkar" düğmesi. */
export default function SharedBadge({ record, onRemove }: { record: SharedPick; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" data-testid="shared">
      <span
        title={`İndirilen Story görselinde yer aldı: ${sharedAtFmt.format(new Date(record.sharedAt))}`}
        className="inline-flex items-center rounded-full border border-brand bg-navy-800 px-2 py-0.5 font-bold whitespace-nowrap text-brand"
        data-testid="shared-badge"
      >
        Paylaşıldı
      </span>
      {confirming ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-muted">Paylaşılandan çıkarılsın mı?</span>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              onRemove()
            }}
            data-testid="shared-remove-confirm"
            className="rounded-lg border border-loss-line bg-loss-soft px-2 py-1 font-bold text-loss-text"
          >
            Evet, çıkar
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-navy-500 px-2 py-1 font-bold">
            Vazgeç
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          data-testid="shared-remove"
          className="-my-1 py-1 font-semibold text-muted underline hover:text-white"
        >
          Paylaşılandan çıkar
        </button>
      )}
      {record.afterKickoff && (
        <span className="w-full text-warn" data-testid="shared-late">
          {LATE_SHARE_NOTE}
        </span>
      )}
    </div>
  )
}
