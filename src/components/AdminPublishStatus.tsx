import { MEMBER_SITE_UPDATE_HINT, type SiteVersionStatus } from '../services/memberAdmin/siteVersion'
import type { PublicationRecord } from '../services/memberAdmin/types'
import { toAppDateTime } from '../utils/date'
import { formatDay } from '../utils/format'

/** "no N · zaman · gün"; hiç yayın yoksa bunu söyler */
export function lastPublicationText(publications: readonly PublicationRecord[]): string {
  const last = publications[0]
  if (!last) return 'henüz yayın yok'
  const at = toAppDateTime(new Date(last.publishedAt))
  return `no ${last.n} · ${formatDay(at.date)} ${at.time} · gün ${formatDay(last.day)}`
}

/**
 * Admin sayfasında her sekmede görünen yayın durumu: son yayının özeti (salt okunur) ve
 * YAYINLA kartına götüren kısayol. Yayının kendisi yalnızca ÜYELER sekmesindeki karttan yapılır.
 * Üye sitesi paketi açamıyorsa (incompatible) bunu da burada, kırmızı bantla söyler.
 */
export default function AdminPublishStatus({ publications, siteStatus, onOpen }: { publications: readonly PublicationRecord[]; siteStatus: SiteVersionStatus | null; onOpen: () => void }) {
  return (
    <>
      {siteStatus?.level === 'incompatible' && (
        <p role="alert" data-testid="admin-site-incompatible" className="mb-4 min-w-0 rounded-2xl border border-loss-line bg-loss-soft p-3 text-sm font-bold text-loss-text">
          <span aria-hidden="true">⚠ </span>
          {siteStatus.text} <span className="font-normal">{MEMBER_SITE_UPDATE_HINT}</span>
        </p>
      )}
      <div data-testid="admin-publish-status" className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-2xl border border-line bg-navy-800 px-3 py-2">
        <p className="min-w-0 text-xs text-muted">
          <span className="font-bold text-white">Son yayın:</span> <span data-testid="admin-last-publication">{lastPublicationText(publications)}</span>
        </p>
        <button type="button" onClick={onOpen} data-testid="admin-publish-shortcut" className="shrink-0 text-xs font-bold text-brand hover:underline">
          Yayınla →
        </button>
      </div>
    </>
  )
}
