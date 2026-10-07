import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DEFAULT_MEMBER_TEXTS } from '../config/memberTexts'
import type { MemberErrorKind, SignOutReason } from '../services/member/controller'
import { MEMBER_ERROR_TEXTS, MEMBER_NOTICE_TEXTS } from '../services/member/labels'
import MemberLegalNotice from './MemberLegalNotice'

interface Props {
  busy: boolean
  error: MemberErrorKind | null
  notice: SignOutReason | null
  onLogin: (username: string, password: string) => void
  /** Verilirse hata metninin altında "Yeniden dene" düğmesi çıkar (kayıtlı oturumu şifresiz sürdürür) */
  onRetry?: () => void
  /** Yalnızca testler için: yasal uyarı kabul edilmiş olarak başlar. Uygulama bunu vermez. */
  initialAccepted?: boolean
}

const INPUT =
  'mt-1 w-full min-w-0 rounded-xl border border-navy-500 bg-navy-800 px-3 py-2.5 text-base text-white outline-none focus:border-brand disabled:opacity-60'

/**
 * Üye girişi. Şifre yalnızca bu bileşenin belleğinde durur; hiçbir yere kaydedilmez.
 * Giriş ekranı her açıldığında önce yasal uyarı penceresi gösterilir; kabul edilene kadar
 * form etkisizdir (alanlar pasif, gönderme engelli). Onay yalnızca bu bileşenin belleğindedir.
 */
export default function MemberLogin({ busy, error, notice, onLogin, onRetry, initialAccepted = false }: Props) {
  const [accepted, setAccepted] = useState(initialAccepted)
  const usernameInput = useRef<HTMLInputElement>(null)
  const locked = busy || !accepted
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!locked) onLogin(username, password)
  }

  // Onaydan sonra odak ilk alana geçer.
  const wasAccepted = useRef(accepted)
  useEffect(() => {
    if (accepted && !wasAccepted.current) usernameInput.current?.focus()
    wasAccepted.current = accepted
  }, [accepted])

  return (
    <div className="mx-auto w-full max-w-sm">
      {!accepted && <MemberLegalNotice onAccept={() => setAccepted(true)} />}
      <div inert={!accepted} aria-hidden={!accepted || undefined} data-testid="member-login-content">
      <h1 className="text-2xl font-black tracking-tight">ÜYE GİRİŞİ</h1>
      <form onSubmit={submit} className="mt-4 rounded-2xl border border-line bg-navy-700 p-4" data-testid="member-login">
        <label className="block text-xs font-bold text-muted">
          Kullanıcı adı
          <input
            ref={usernameInput}
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={locked}
            required
            data-testid="member-username"
            className={INPUT}
          />
        </label>
        <label className="mt-3 block text-xs font-bold text-muted">
          Şifre
          <span className="mt-1 flex gap-2">
            <input
              name="password"
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={locked}
              required
              data-testid="member-password"
              className={`${INPUT} mt-0 font-mono tracking-wide`}
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              disabled={!accepted}
              aria-pressed={visible}
              data-testid="member-password-toggle"
              className="shrink-0 rounded-xl border border-navy-500 px-3 text-xs font-bold text-white hover:bg-navy-600"
            >
              {visible ? 'Gizle' : 'Göster'}
            </button>
          </span>
        </label>
        <p className="mt-1.5 text-[11px] text-muted">Büyük/küçük harf ve tire fark etmez.</p>

        {notice && !error && (
          <p className="mt-3 text-sm text-warn" data-testid="member-notice">
            {MEMBER_NOTICE_TEXTS[notice]}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-loss-text" data-testid="member-error" data-error={error}>
            {MEMBER_ERROR_TEXTS[error]}
          </p>
        )}
        {error && onRetry && (
          <button type="button" onClick={onRetry} disabled={locked} data-testid="member-retry" className="mt-2 rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold text-white hover:bg-navy-600 disabled:opacity-60">
            Yeniden dene
          </button>
        )}

        <button
          type="submit"
          disabled={locked}
          data-testid="member-submit"
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-extrabold text-navy-950 hover:bg-brand-dark disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? 'Giriş yapılıyor…' : 'GİRİŞ YAP'}
        </button>
        {busy && (
          <div className="mt-3" role="status" aria-live="polite" data-testid="member-progress">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-brand" />
            </div>
            <p className="mt-1.5 text-xs text-muted">Yayın açılıyor; eski cihazlarda birkaç saniye sürebilir.</p>
          </div>
        )}
      </form>

      <div className="mt-4 space-y-1.5 text-xs text-muted" data-testid="member-fixed-notes">
        <p>{DEFAULT_MEMBER_TEXTS.disclaimer}</p>
        <p>{DEFAULT_MEMBER_TEXTS.account}</p>
      </div>
      </div>
    </div>
  )
}
