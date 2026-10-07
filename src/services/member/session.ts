import { fromBase64, toBase64, type MemberKeys } from './crypto'
import { MEMBER_SESSION_KEY } from './sessionFlag'

// Üye oturumu: şifre HİÇBİR yerde saklanmaz. Sekmenin sessionStorage'ında yalnızca
// şifreden türetilmiş anahtarlar ve son işlem zamanı tutulur; sekme kapanınca silinir.

/** sessionStorage'ın kullanılan kısmı (testte bellekteki karşılığı verilir) */
export interface SessionStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface Stored {
  kek: string
  idKey: string
  /** Son işlem anı (ms) */
  at: number
}

export function saveSession(store: SessionStore, keys: MemberKeys, now: number): void {
  const value: Stored = { kek: toBase64(keys.kek), idKey: toBase64(keys.idKey), at: now }
  store.setItem(MEMBER_SESSION_KEY, JSON.stringify(value))
}

export function clearSession(store: SessionStore): void {
  store.removeItem(MEMBER_SESSION_KEY)
}

/**
 * Kayıtlı oturumu okur. Kayıt yoksa, bozuksa ya da son işlemden bu yana idleMs geçtiyse
 * null döner ve kaydı siler.
 */
export function loadSession(store: SessionStore, now: number, idleMs: number): MemberKeys | null {
  const raw = store.getItem(MEMBER_SESSION_KEY)
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<Stored>
    if (typeof value.at !== 'number' || now - value.at >= idleMs || now < value.at - 60_000) throw new Error('süre')
    return { kek: fromBase64(value.kek, 'kek', 32), idKey: fromBase64(value.idKey, 'idKey', 32) }
  } catch {
    clearSession(store)
    return null
  }
}

/** Son işlem zamanını günceller; oturum yoksa bir şey yapmaz */
export function touchSession(store: SessionStore, now: number): void {
  const raw = store.getItem(MEMBER_SESSION_KEY)
  if (raw === null) return
  try {
    const value = JSON.parse(raw) as Stored
    store.setItem(MEMBER_SESSION_KEY, JSON.stringify({ kek: value.kek, idKey: value.idKey, at: now }))
  } catch {
    clearSession(store)
  }
}
