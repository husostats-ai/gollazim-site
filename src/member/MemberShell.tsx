import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { MEMBER_STALE_HOURS } from '../config/member'
import type { MemberErrorKind } from '../services/member/controller'
import { MEMBER_ERROR_TEXTS, STALE_DATA_TEXT } from '../services/member/labels'
import type { MemberPayload } from '../services/member/payload'
import { isStale, updatedText } from './view'

const tab = ({ isActive }: { isActive: boolean }) =>
  ['shrink-0 rounded-full px-3.5 py-2 text-xs font-bold tracking-wide whitespace-nowrap transition-colors', isActive ? 'bg-brand text-navy-950' : 'text-muted hover:bg-navy-700 hover:text-white'].join(' ')

/** Üye sayfasının sade düzeni: logo, iki sekme, çıkış. Admin gezinmesi burada yoktur. */
export function MemberFrame({ children, actions, nav }: { children: ReactNode; actions?: ReactNode; nav?: ReactNode }) {
  return (
    <div className="min-h-dvh" data-testid="member-frame">
      <header className="sticky top-0 z-20 border-b border-line bg-navy-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <span className="flex min-w-0 shrink items-center gap-2.5">
            <img src="./logo-256.png" alt="GOLLAZIM" className="h-10 w-10 shrink-0 rounded-xl" />
            <span className="truncate text-lg font-black italic tracking-tight sm:text-2xl">
              GOL<span className="text-brand">LAZIM</span>
            </span>
            <span className="shrink-0 rounded-full border border-navy-500 px-2 py-0.5 text-[10px] font-bold text-muted">ÜYE</span>
          </span>
          <span className="ml-auto shrink-0">{actions}</span>
        </div>
        {nav && <nav className="no-scrollbar mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-2.5">{nav}</nav>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}

interface Props {
  payload: MemberPayload
  /** Şu an (ms) ve bugünün tarihi (Türkiye saati) */
  now: number
  today: string
  refreshError: MemberErrorKind | null
  onLogout: () => void
  /** Uygulamanın bağlandığı yol: ayrı üye sitesinde '', eski adreste '/uye' */
  basePath?: string
  children: ReactNode
}

export default function MemberShell({ payload, now, today, refreshError, onLogout, basePath = '/uye', children }: Props) {
  return (
    <MemberFrame
      actions={
        <button type="button" onClick={onLogout} data-testid="member-logout" className="rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-600">
          Çıkış
        </button>
      }
      nav={
        <>
          <NavLink to={basePath || '/'} end className={tab}>
            ANALİZLER
          </NavLink>
          <NavLink to={`${basePath}/istatistik`} className={tab}>
            İSTATİSTİK
          </NavLink>
        </>
      }
    >
      <div className="mb-4 rounded-xl border border-line bg-navy-800 px-3 py-2.5 text-xs text-muted" data-testid="member-banner">
        <p className="flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-semibold text-white" data-testid="member-updated">
            {updatedText(payload.publishedAt, today)}
          </span>
          <span data-testid="member-publish-no">Yayın no {payload.n}</span>
        </p>
        {isStale(payload.publishedAt, now, MEMBER_STALE_HOURS) && (
          <p className="mt-1 font-bold text-warn" data-testid="member-stale">
            ⚠ {STALE_DATA_TEXT}
          </p>
        )}
        {refreshError && (
          <p className="mt-1 text-warn" data-testid="member-refresh-error">
            Yeni yayın denetlenemedi: {MEMBER_ERROR_TEXTS[refreshError]}
          </p>
        )}
        <p className="mt-1.5" data-testid="member-disclaimer">
          {payload.texts.disclaimer}
        </p>
        <p className="mt-0.5">{payload.texts.account}</p>
      </div>
      {children}
      {/* Yasal uyarı sayfanın en altında da yer alır: uzun listelerin sonunda da görünür. */}
      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted" data-testid="member-footer">
        <p className="font-semibold text-white">{payload.texts.disclaimer}</p>
        <p className="mt-1">{payload.texts.account}</p>
      </footer>
    </MemberFrame>
  )
}
