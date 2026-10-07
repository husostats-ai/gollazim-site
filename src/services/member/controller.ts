import { deriveMemberKeys, fromBase64, MemberAccessError, MemberEnvelopeError, normalizePassword, normalizeUsername, openWithKeys, type MemberKeys } from './crypto'
import type { MemberPayload } from './payload'
import { clearSession, loadSession, saveSession, touchSession, type SessionStore } from './session'
import { fetchEnvelope, MemberSourceError, type FetchLike, type SourceErrorKind } from './source'

// Üye sayfasının durumu: giriş, oturum, yeni yayın denetimi, çıkış. Arayüzden bağımsızdır.

/**
 * credentials: kullanıcı adı ya da şifre hatalı. corrupt: paket indi ama içeriği
 * doğrulanamadı. unsupported: tarayıcı/bağlantı şifrelemeyi desteklemiyor.
 * Diğerleri paketin getirilmesiyle ilgilidir (bkz. source.ts).
 */
export type MemberErrorKind = 'credentials' | 'corrupt' | 'unsupported' | SourceErrorKind

/** expired: hareketsizlikten kapandı. revoked: yeni yayında bu hesabın erişimi yok. */
export type SignOutReason = 'expired' | 'revoked'

export type MemberState =
  | { status: 'starting' }
  | { status: 'signedOut'; busy: boolean; error: MemberErrorKind | null; notice: SignOutReason | null }
  | { status: 'signedIn'; payload: MemberPayload; refreshError: MemberErrorKind | null }

export interface ControllerOptions {
  url: string
  fetchImpl: FetchLike
  store: SessionStore
  now: () => number
  idleMs: number
}

export interface MemberController {
  getState(): MemberState
  subscribe(listener: () => void): () => void
  /** Sayfa açılışı: kayıtlı oturum varsa şifre sormadan sürdürür */
  start(): Promise<void>
  login(username: string, password: string): Promise<void>
  logout(): void
  /** Yeni yayın var mı diye bakar; varsa türetilmiş anahtarla (PBKDF2'siz) açar */
  refresh(): Promise<void>
  /** Kullanıcı işlemi: hareketsizlik sayacını sıfırlar */
  touch(): void
  /** Hareketsizlik süresi dolduysa oturumu kapatır */
  checkIdle(): void
}

const errorKind = (error: unknown): MemberErrorKind => {
  if (error instanceof MemberSourceError) return error.kind
  if (error instanceof MemberAccessError) return 'credentials'
  if (error instanceof MemberEnvelopeError) return 'corrupt'
  return 'unsupported'
}

export function createMemberController(options: ControllerOptions): MemberController {
  const { url, fetchImpl, store, now, idleMs } = options
  let state: MemberState = { status: 'starting' }
  let keys: MemberKeys | null = null
  let started = false
  const listeners = new Set<() => void>()

  const set = (next: MemberState) => {
    state = next
    listeners.forEach((listener) => listener())
  }

  /** Anahtarları ve çözülmüş veriyi bellekten ve depodan siler */
  const drop = (notice: SignOutReason | null, error: MemberErrorKind | null = null) => {
    if (keys) {
      keys.kek.fill(0)
      keys.idKey.fill(0)
    }
    keys = null
    clearSession(store)
    set({ status: 'signedOut', busy: false, error, notice })
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async start() {
      // Geliştirmede bileşen iki kez bağlanır; açılış bir kez yapılır.
      if (started) return
      started = true
      const saved = loadSession(store, now(), idleMs)
      if (!saved) return set({ status: 'signedOut', busy: false, error: null, notice: null })
      try {
        const payload = await openWithKeys(await fetchEnvelope(url, fetchImpl, now()), saved)
        keys = saved
        set({ status: 'signedIn', payload, refreshError: null })
      } catch (error) {
        // Erişim kalkmışsa oturum kapanır. Ağ ya da paket sorununda kayıt silinmez: giriş
        // ekranında hata görünür, sayfa yenilenince oturum şifre sorulmadan sürer.
        if (error instanceof MemberAccessError) {
          keys = saved
          drop('revoked')
        } else set({ status: 'signedOut', busy: false, error: errorKind(error), notice: null })
      }
    },

    async login(username, password) {
      if (state.status === 'signedOut' && state.busy) return
      try {
        // Biçimi tutmayan girişte ne paket indirilir ne türetme yapılır.
        normalizeUsername(username)
        normalizePassword(password)
      } catch {
        return set({ status: 'signedOut', busy: false, error: 'credentials', notice: null })
      }
      set({ status: 'signedOut', busy: true, error: null, notice: null })
      try {
        const envelope = await fetchEnvelope(url, fetchImpl, now())
        const derived = await deriveMemberKeys({ username, password, siteSalt: fromBase64(envelope.siteSalt, 'siteSalt'), iterations: envelope.kdf.iterations })
        const payload = await openWithKeys(envelope, derived)
        keys = derived
        saveSession(store, derived, now())
        set({ status: 'signedIn', payload, refreshError: null })
      } catch (error) {
        set({ status: 'signedOut', busy: false, error: errorKind(error), notice: null })
      }
    },

    logout() {
      drop(null)
    },

    async refresh() {
      if (state.status !== 'signedIn' || !keys) return
      const current = state.payload
      const held = keys
      try {
        const envelope = await fetchEnvelope(url, fetchImpl, now())
        // Çıkış yapıldıysa ya da aynı yayınsa bir şey yapılmaz.
        if (keys !== held) return
        if (envelope.n === current.n && envelope.publishedAt === current.publishedAt) {
          if (state.status === 'signedIn' && state.refreshError) set({ status: 'signedIn', payload: current, refreshError: null })
          return
        }
        const payload = await openWithKeys(envelope, held)
        if (keys !== held) return
        set({ status: 'signedIn', payload, refreshError: null })
      } catch (error) {
        if (keys !== held) return
        if (error instanceof MemberAccessError) drop('revoked')
        // Geçici sorunlarda eldeki veri gösterilmeye devam eder.
        else set({ status: 'signedIn', payload: current, refreshError: errorKind(error) })
      }
    },

    touch() {
      if (state.status === 'signedIn') touchSession(store, now())
    },

    checkIdle() {
      if (state.status === 'signedIn' && loadSession(store, now(), idleMs) === null) drop('expired')
    },
  }
}
