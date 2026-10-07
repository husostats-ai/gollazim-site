import { useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { MEMBER_IDLE_HOURS, MEMBER_PACKAGE_URL, MEMBER_POLL_MINUTES } from '../config/member'
import { createMemberController } from '../services/member/controller'
import { todayInAppZone } from '../utils/date'
import MemberAnalysis from './MemberAnalysis'
import MemberLogin from './MemberLogin'
import MemberShell, { MemberFrame } from './MemberShell'
import MemberStatsPage from './MemberStatsPage'

const controller = createMemberController({
  url: MEMBER_PACKAGE_URL,
  fetchImpl: (url, init) => fetch(url, init),
  store: sessionStorage,
  now: () => Date.now(),
  idleMs: MEMBER_IDLE_HOURS * 3_600_000,
})

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll'] as const

/**
 * Üye girişi ve salt okunur üye sayfaları. Uygulamanın geri kalanından bağımsızdır.
 * basePath: uygulamanın bağlandığı yol. Ayrı üye sitesinde kök (''), eski adreste '/uye'.
 */
export default function MemberApp({ basePath = '/uye' }: { basePath?: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  const [now, setNow] = useState(() => Date.now())
  const signedIn = state.status === 'signedIn'

  useEffect(() => {
    void controller.start()
  }, [])

  useEffect(() => {
    if (!signedIn) return
    // İşlem yapıldıkça hareketsizlik sayacı sıfırlanır (dakikada en çok bir kez yazılır).
    let last = 0
    const onActivity = () => {
      if (Date.now() - last < 60_000) return
      last = Date.now()
      controller.touch()
    }
    const tick = () => {
      setNow(Date.now())
      controller.checkIdle()
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      void controller.refresh()
    }
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    const idleTimer = window.setInterval(tick, 60_000)
    const pollTimer = window.setInterval(() => void controller.refresh(), MEMBER_POLL_MINUTES * 60_000)
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(idleTimer)
      window.clearInterval(pollTimer)
    }
  }, [signedIn])

  if (state.status === 'starting')
    return (
      <MemberFrame>
        <p className="text-sm text-muted" data-testid="member-starting">
          Yükleniyor…
        </p>
      </MemberFrame>
    )

  if (state.status === 'signedOut')
    return (
      <MemberFrame>
        <MemberLogin busy={state.busy} error={state.error} notice={state.notice} onLogin={(username, password) => void controller.login(username, password)} onRetry={state.resumable ? () => void controller.retry() : undefined} />
      </MemberFrame>
    )

  const today = todayInAppZone()
  return (
    <MemberShell payload={state.payload} now={now} today={today} refreshError={state.refreshError} onLogout={controller.logout} basePath={basePath}>
      <Routes>
        <Route index element={<MemberAnalysis payload={state.payload} today={today} />} />
        <Route path="istatistik" element={<MemberStatsPage payload={state.payload} />} />
        <Route path="*" element={<Navigate to={basePath || '/'} replace />} />
      </Routes>
    </MemberShell>
  )
}
