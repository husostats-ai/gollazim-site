import { useEffect, useState } from 'react'
import { behindMainText, fetchBehindMain, isDeployedAdmin } from '../services/memberAdmin/adminBehind'

/** Admin derlemesi main'in gerisindeyse uyarı; değilse ya da öğrenilemezse hiçbir şey göstermez. */
export default function AdminBehindMain() {
  const [behind, setBehind] = useState<number | null>(null)

  useEffect(() => {
    if (!isDeployedAdmin(window.location.hostname)) return
    let cancelled = false
    void fetchBehindMain(__APP_COMMIT__, (url, init) => fetch(url, init)).then((n) => !cancelled && setBehind(n))
    return () => {
      cancelled = true
    }
  }, [])

  if (behind === null || behind === 0) return null
  return (
    <p role="status" className="mb-4 rounded-2xl border border-warn-line bg-warn-soft p-3 text-sm font-bold text-warn" data-testid="admin-behind-main" data-behind={behind}>
      <span aria-hidden="true">⚠ </span>
      {behindMainText(__APP_COMMIT__, behind)}
    </p>
  )
}
