import { normalizeMemberTexts } from '../../config/memberTexts'
import { fromBase64, isValidUsername, KDF_ITERATIONS, KDF_NAME, randomBytes, toBase64 } from '../member/crypto'
import type { MemberRecord, MemberSnapshot, PublicationRecord } from './types'

// Üye anahtar yedeği: üye listesi, türetilmiş anahtarlar ve yayın sayacı, admin'in
// belirlediği parolayla şifrelenmiş AYRI bir dosyada tutulur (normal JSON yedeğine girmez).
//   anahtar = PBKDF2-SHA256(parola, tuz, iterasyon) → AES-256-GCM
//   başlık (biçim, sürüm, oluşturma anı, KDF parametreleri, tuz) ek doğrulanmış veridir.
// Düz anahtarlar dosyaya yazılmaz; bu yedek kaybolursa tüm şifreler yeniden dağıtılır.

export const KEY_BACKUP_FORMAT = 'gollazim-uye-anahtar'
export const KEY_BACKUP_VERSION = 1
export const PASSPHRASE_MIN_LENGTH = 12

export const keyBackupFileName = (today: string): string => `gollazim-uye-anahtar-${today}.json`

/** format: dosya bir üye anahtar yedeği değil ya da bozuk. passphrase: parola yanlış (ya da içerik değiştirilmiş). */
export class KeyBackupError extends Error {
  constructor(public readonly kind: 'format' | 'passphrase' | 'weak') {
    super(
      kind === 'format'
        ? 'Bu dosya bir üye anahtar yedeği değil ya da bozulmuş.'
        : kind === 'passphrase'
          ? 'Parola yanlış (ya da dosyanın içeriği değiştirilmiş). Yedek yüklenmedi.'
          : `Parola en az ${PASSPHRASE_MIN_LENGTH} karakter olmalı.`,
    )
  }
}

export interface KeyBackupFile {
  format: typeof KEY_BACKUP_FORMAT
  v: typeof KEY_BACKUP_VERSION
  createdAt: string
  kdf: { name: typeof KDF_NAME; iterations: number }
  /** base64, 16 bayt */
  salt: string
  /** base64, 12 bayt */
  nonce: string
  ciphertext: string
}

const FILE_KEYS = ['format', 'v', 'createdAt', 'kdf', 'salt', 'nonce', 'ciphertext'] as const
type Bytes = Uint8Array<ArrayBuffer>
const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes

export interface PassphraseCheck {
  /** Yedek alınabilir mi (en az 12 karakter ve iki giriş aynı) */
  ok: boolean
  /** Engelleyen sorun */
  error: string | null
  /** Engellemeyen uyarılar: parola zayıf görünüyor */
  warnings: string[]
}

/** Parolayı denetler: kısa ya da iki giriş farklıysa engeller, zayıfsa uyarır. */
export function checkPassphrase(passphrase: string, repeat: string): PassphraseCheck {
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) return { ok: false, error: `Parola en az ${PASSPHRASE_MIN_LENGTH} karakter olmalı.`, warnings: [] }
  if (passphrase !== repeat) return { ok: false, error: 'İki parola aynı değil.', warnings: [] }
  const warnings: string[] = []
  const classes = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /\d/, /[^\p{L}\d]/u].filter((pattern) => pattern.test(passphrase)).length
  if (new Set(passphrase).size < 6) warnings.push('Parola çok az farklı karakter içeriyor.')
  if (classes < 2 && passphrase.length < 20) warnings.push('Parola tek tür karakterden oluşuyor; harf, rakam ve işaret karıştırın ya da birkaç sözcüklü uzun bir parola kullanın.')
  if (/gollazim|gol ?lazim|sifre|şifre|parola|password|123456|qwerty/i.test(passphrase)) warnings.push('Parola kolay tahmin edilen bir sözcük ya da dizi içeriyor.')
  if (/^(.+?)\1+$/.test(passphrase)) warnings.push('Parola aynı parçanın tekrarından oluşuyor.')
  return { ok: true, error: null, warnings }
}

const aad = (h: Pick<KeyBackupFile, 'format' | 'v' | 'createdAt' | 'kdf' | 'salt'>): Bytes => utf8(JSON.stringify([h.format, h.v, h.createdAt, h.kdf.name, h.kdf.iterations, h.salt]))

async function deriveKey(passphrase: string, salt: Bytes, iterations: number, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey'])
  return globalThis.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage])
}

/** Üye kayıtlarını parolayla şifreler. Parola en az 12 karakter değilse KeyBackupError('weak'). */
export async function sealKeyBackup(snapshot: MemberSnapshot, passphrase: string, createdAt: string): Promise<KeyBackupFile> {
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) throw new KeyBackupError('weak')
  // İçerik anahtar türetilmeden önce doğrulanır: geçersiz kayıt yedeğe yazılmaz.
  const content = utf8(JSON.stringify(normalizeSnapshot(snapshot)))
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const header = { format: KEY_BACKUP_FORMAT, v: KEY_BACKUP_VERSION, createdAt, kdf: { name: KDF_NAME, iterations: KDF_ITERATIONS.default }, salt: toBase64(salt) } as const
  const key = await deriveKey(passphrase, salt, header.kdf.iterations, 'encrypt')
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(header) }, key, content))
  return { ...header, nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) }
}

const isIso = (value: unknown): value is string => typeof value === 'string' && value.length <= 30 && !Number.isNaN(Date.parse(value))

function memberOf(value: unknown): MemberRecord {
  const m = value as Partial<MemberRecord> | null
  if (typeof m !== 'object' || m === null || typeof m.username !== 'string' || !isValidUsername(m.username) || typeof m.active !== 'boolean' || !isIso(m.createdAt)) throw new KeyBackupError('format')
  const key = (v: unknown, field: string): string | null => {
    if (v === null) return null
    fromBase64(v, field, 32)
    return v as string
  }
  const kek = key(m.kek, 'kek')
  const idKey = key(m.idKey, 'idKey')
  // Aktif üyenin iki anahtarı da olmalı; çıkarılmış üyede anahtar bulunmaz.
  if (m.active !== (kek !== null && idKey !== null) || (kek === null) !== (idKey === null)) throw new KeyBackupError('format')
  return { username: m.username, kek, idKey, active: m.active, createdAt: m.createdAt, ...(isIso(m.renewedAt) && { renewedAt: m.renewedAt }), ...(isIso(m.removedAt) && { removedAt: m.removedAt }) }
}

function publicationOf(value: unknown): PublicationRecord {
  const p = value as Partial<PublicationRecord> | null
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
  if (typeof p !== 'object' || p === null || !count(p.n) || p.n < 1 || !isIso(p.publishedAt) || typeof p.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.day) || !count(p.memberCount) || !count(p.bytes)) throw new KeyBackupError('format')
  return { n: p.n, publishedAt: p.publishedAt, day: p.day, memberCount: p.memberCount, bytes: p.bytes }
}

/** Yedeğin içeriğini doğrular ve yalnızca bilinen alanlarla yeniden kurar. */
function normalizeSnapshot(value: unknown): MemberSnapshot {
  const s = value as Partial<MemberSnapshot> | null
  if (typeof s !== 'object' || s === null || !Array.isArray(s.members) || !Array.isArray(s.publications)) throw new KeyBackupError('format')
  if (typeof s.publishCounter !== 'number' || !Number.isInteger(s.publishCounter) || s.publishCounter < 0) throw new KeyBackupError('format')
  if (s.siteSalt !== null) fromBase64(s.siteSalt, 'siteSalt', 16)
  const members = s.members.map(memberOf)
  if (new Set(members.map((m) => m.username)).size !== members.length) throw new KeyBackupError('format')
  if (members.some((m) => m.active) && s.siteSalt === null) throw new KeyBackupError('format')
  return { members, siteSalt: s.siteSalt as string | null, publishCounter: s.publishCounter, texts: normalizeMemberTexts(s.texts), publications: s.publications.map(publicationOf) }
}

/** Dosyanın dış biçimini denetler (çözmeden). */
export function parseKeyBackup(input: unknown): KeyBackupFile {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new KeyBackupError('format')
    }
  }
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('nesne değil')
    const f = value as Record<string, unknown>
    const keys = Object.keys(f)
    if (keys.length !== FILE_KEYS.length || !FILE_KEYS.every((k) => keys.includes(k))) throw new Error('alanlar')
    if (f.format !== KEY_BACKUP_FORMAT || f.v !== KEY_BACKUP_VERSION || !isIso(f.createdAt)) throw new Error('başlık')
    const kdf = f.kdf as Record<string, unknown> | null
    if (typeof kdf !== 'object' || kdf === null || Object.keys(kdf).sort().join() !== 'iterations,name' || kdf.name !== KDF_NAME) throw new Error('kdf')
    const iterations = kdf.iterations
    if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < KDF_ITERATIONS.min || iterations > KDF_ITERATIONS.max) throw new Error('iterasyon')
    fromBase64(f.salt, 'salt', 16)
    fromBase64(f.nonce, 'nonce', 12)
    if (typeof f.ciphertext !== 'string' || f.ciphertext.length < 24 || f.ciphertext.length > 4_000_000) throw new Error('içerik')
    fromBase64(f.ciphertext, 'ciphertext')
    return { format: KEY_BACKUP_FORMAT, v: KEY_BACKUP_VERSION, createdAt: f.createdAt, kdf: { name: KDF_NAME, iterations }, salt: f.salt as string, nonce: f.nonce as string, ciphertext: f.ciphertext }
  } catch {
    throw new KeyBackupError('format')
  }
}

/**
 * Yedeği parolayla açar. Dosya bir yedek değilse ya da bozuksa KeyBackupError('format'),
 * parola yanlışsa (ya da içerik değiştirilmişse) KeyBackupError('passphrase') verir.
 */
export async function openKeyBackup(input: unknown, passphrase: string): Promise<{ snapshot: MemberSnapshot; createdAt: string }> {
  const file = parseKeyBackup(input)
  let plain: ArrayBuffer
  try {
    const key = await deriveKey(passphrase, fromBase64(file.salt, 'salt'), file.kdf.iterations, 'decrypt')
    plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.nonce, 'nonce'), additionalData: aad(file) }, key, fromBase64(file.ciphertext, 'ciphertext'))
  } catch {
    throw new KeyBackupError('passphrase')
  }
  try {
    return { snapshot: normalizeSnapshot(JSON.parse(new TextDecoder().decode(plain))), createdAt: file.createdAt }
  } catch {
    throw new KeyBackupError('format')
  }
}
