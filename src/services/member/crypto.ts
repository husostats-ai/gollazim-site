import type { MemberPayload } from './payload'
import { assertMemberPayload, MemberPayloadError } from './schema'

// Üye yayın paketinin şifrelenmesi ve çözülmesi (WebCrypto).
//
// Şema:
//   tuz    = SHA-256("gollazim-uye|v1|tuz|" || siteSalt || kullanıcıAdı)
//   ana    = PBKDF2-SHA256(şifre, tuz, iterasyon) → 256 bit
//   kek    = HKDF-SHA256(ana, "gollazim-uye|v1|kek")   AES-KW sarma anahtarı
//   idKey  = HKDF-SHA256(ana, "gollazim-uye|v1|id")    HMAC anahtarı
//   Her yayında: yeni rastgele DEK (256 bit), yeni 96 bit nonce, yeni yayın nonce'u.
//   şifreliMetin = AES-256-GCM(DEK, nonce, AAD = başlık, paket JSON)
//   yuva         = HMAC-SHA256(idKey, yayınNonce)[0..16] || AES-KW(kek, DEK)
//
// Admin şifreyi saklamaz; yalnızca kek ve idKey'i (MemberKeys) saklar. Yayın sırasında
// PBKDF2 çalışmaz. Yuva kimlikleri her yayında değişir, liste sabit sayıya rastgele
// yuvalarla doldurulur ve karıştırılır: paketten üye sayısı ya da kimliği okunamaz.
// Bu dosyada hiçbir gizli değer, sabit şifre ya da anahtar yoktur.

export const ENVELOPE_FORMAT = 'gollazim-uye-paket'
export const ENVELOPE_VERSION = 1
export const KDF_NAME = 'PBKDF2-SHA256'

/** PBKDF2 iterasyon sınırları. Alt sınırın altındaki paket zayıftır, üstündeki cihazı kilitler: ikisi de reddedilir. */
export const KDF_ITERATIONS = { min: 600_000, default: 600_000, max: 2_000_000 } as const

/** Sarmal listesinin varsayılan (sabit) uzunluğu; üye sayısı aşarsa bu sayının katlarına çıkar */
export const DEFAULT_SLOT_COUNT = 64
const MAX_SLOTS = 1024

/** Karışabilecek karakterler yok: 0 1 I L O U */
export const PASSWORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const PASSWORD_LENGTH = 16
const PASSWORD_GROUP = 4

const SITE_SALT_BYTES = 16
const PUBLISH_NONCE_BYTES = 16
const GCM_NONCE_BYTES = 12
const KEY_BYTES = 32
const SLOT_ID_BYTES = 16
/** AES-KW, 32 baytlık anahtarı 40 bayta sarar */
const WRAPPED_BYTES = 40
const SLOT_BYTES = SLOT_ID_BYTES + WRAPPED_BYTES
/** Şifreli metnin üst sınırı (base64 karakter); beklenen paketin çok üstünde */
const MAX_CIPHERTEXT_CHARS = 8_000_000

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/

type Bytes = Uint8Array<ArrayBuffer>

/** Girişte kullanıcıya gösterilen tek mesaj: hangi bilginin yanlış olduğu söylenmez */
export const ACCESS_DENIED_TEXT = 'Kullanıcı adı veya şifre hatalı.'
export const ENVELOPE_ERROR_TEXT = 'Yayın paketi okunamadı.'

/**
 * Giriş reddedildi. format: girilen metin beklenen biçimde değil (türetme yapılmadı).
 * denied: bu kullanıcı adı ve şifreyle açılan bir yuva yok.
 */
export class MemberAccessError extends Error {
  constructor(public readonly kind: 'format' | 'denied') {
    super(ACCESS_DENIED_TEXT)
  }
}

/** Paket bozuk, değiştirilmiş ya da desteklenmeyen sürümde */
export class MemberEnvelopeError extends Error {
  constructor(public readonly detail: string) {
    super(ENVELOPE_ERROR_TEXT)
  }
}

/** Bir üyenin şifresinden türetilen anahtarlar; admin şifre yerine bunları saklar */
export interface MemberKeys {
  /** DEK'i saran anahtar (AES-KW), 32 bayt */
  kek: Bytes
  /** Yuva kimliğini üreten anahtar (HMAC), 32 bayt */
  idKey: Bytes
}

export interface MemberEnvelope {
  format: typeof ENVELOPE_FORMAT
  v: typeof ENVELOPE_VERSION
  /** Yayın numarası (açık; "yeni yayın var mı" denetimi için) */
  n: number
  publishedAt: string
  kdf: { name: typeof KDF_NAME; iterations: number }
  /** base64, 16 bayt; sitenin tüm yayınlarında aynıdır */
  siteSalt: string
  /** base64, 16 bayt; her yayında yenidir, yuva kimlikleri buna bağlıdır */
  publishNonce: string
  /** base64, 12 bayt; AES-GCM nonce'u */
  nonce: string
  /** base64, her biri 56 bayt: 16 bayt kimlik + 40 bayt sarılmış DEK */
  slots: string[]
  /** base64; AES-GCM şifreli metin + doğrulama etiketi */
  ciphertext: string
}

const ENVELOPE_KEYS = ['format', 'v', 'n', 'publishedAt', 'kdf', 'siteSalt', 'publishNonce', 'nonce', 'slots', 'ciphertext'] as const

const subtle = (): SubtleCrypto => {
  const api = globalThis.crypto?.subtle
  // Tarayıcılar WebCrypto'yu yalnızca HTTPS ve localhost'ta açar.
  if (!api) throw new Error('Bu tarayıcıda ya da bağlantıda şifreleme kullanılamıyor (HTTPS gerekir).')
  return api
}

const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes

export const randomBytes = (length: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(length))

/** 0..limit-1 arasında yansız rastgele tam sayı */
function randomInt(limit: number): number {
  const ceiling = Math.floor(0x100000000 / limit) * limit
  const buffer = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buffer)
    if (buffer[0] < ceiling) return buffer[0] % limit
  }
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, i) => value === b[i])

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Katı base64 çözücü; biçim ya da uzunluk tutmuyorsa MemberEnvelopeError */
export function fromBase64(text: unknown, field: string, length?: number): Bytes {
  if (typeof text !== 'string' || !BASE64.test(text)) throw new MemberEnvelopeError(`${field}: base64 değil`)
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (length !== undefined && bytes.length !== length) throw new MemberEnvelopeError(`${field}: ${length} bayt bekleniyor`)
  return bytes
}

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text)

/**
 * Kullanıcı adını giriş için hazırlar: baştaki/sondaki boşluk atılır, küçük harfe çevrilir.
 * Yalnızca ASCII küçük harf, rakam ve . _ - kabul edilir. ASCII dışı karakter (İ, ı, ş…)
 * dönüştürülmez, reddedilir: Türkçe büyük/küçük harf dönüşümü cihazdan cihaza değişmesin.
 */
export function normalizeUsername(input: string): string {
  const trimmed = input.trim()
  if (!isAscii(trimmed)) throw new MemberAccessError('format')
  const lower = trimmed.toLowerCase()
  if (!USERNAME.test(lower)) throw new MemberAccessError('format')
  return lower
}

/** Admin'in belirlediği kullanıcı adı geçerli mi (zaten küçük harf ve boşluksuz olmalı) */
export const isValidUsername = (username: string): boolean => USERNAME.test(username)

/**
 * Şifreyi giriş için hazırlar: boşluklar ve tireler atılır, büyük harfe çevrilir.
 * Sonuç 16 karakter değilse ya da alfabe dışı karakter içeriyorsa (0 1 I L O U, Türkçe
 * harfler…) türetme yapılmadan reddedilir. Tiresiz 16 karakter döner.
 */
export function normalizePassword(input: string): string {
  // Kopyala-yapıştırda gelebilen her tür boşluk ve tire
  const compact = input.replace(/[\s ‐-―−-]/g, '')
  // Önce ASCII denetimi: "ı".toUpperCase() "I", "ß".toUpperCase() "SS" olur; dönüşüme bırakılmaz.
  if (!isAscii(compact)) throw new MemberAccessError('format')
  const upper = compact.toUpperCase()
  if (upper.length !== PASSWORD_LENGTH || [...upper].some((ch) => !PASSWORD_ALPHABET.includes(ch))) throw new MemberAccessError('format')
  return upper
}

/** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS" */
export const formatPassword = (password: string): string => password.match(new RegExp(`.{${PASSWORD_GROUP}}`, 'g'))!.join('-')

/** Yeni rastgele şifre (yaklaşık 78 bit), gösterim biçiminde: XXXX-XXXX-XXXX-XXXX */
export function generatePassword(): string {
  let password = ''
  for (let i = 0; i < PASSWORD_LENGTH; i++) password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return formatPassword(password)
}

/** Sitenin tuzu; kurulumda bir kez üretilir ve her yayının başlığında açık olarak yer alır */
export const newSiteSalt = (): Bytes => randomBytes(SITE_SALT_BYTES)

function checkIterations(iterations: unknown): number {
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < KDF_ITERATIONS.min || iterations > KDF_ITERATIONS.max)
    throw new MemberEnvelopeError(`iterasyon ${KDF_ITERATIONS.min}-${KDF_ITERATIONS.max} aralığında olmalı`)
  return iterations
}

async function hkdf(master: Bytes, info: string): Promise<Bytes> {
  const key = await subtle().importKey('raw', master, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }, key, KEY_BYTES * 8))
}

/**
 * Kullanıcı adı ve şifreden üye anahtarlarını türetir (yavaş: PBKDF2). Girdi önce
 * normalize edilir; biçimi tutmayan girdi türetme yapılmadan MemberAccessError verir.
 */
export async function deriveMemberKeys(input: { username: string; password: string; siteSalt: Uint8Array; iterations?: number }): Promise<MemberKeys> {
  const username = normalizeUsername(input.username)
  const password = normalizePassword(input.password)
  const iterations = checkIterations(input.iterations ?? KDF_ITERATIONS.default)
  if (input.siteSalt.length !== SITE_SALT_BYTES) throw new MemberEnvelopeError('siteSalt: 16 bayt bekleniyor')

  const salt = new Uint8Array(await subtle().digest('SHA-256', concat(utf8('gollazim-uye|v1|tuz|'), input.siteSalt, utf8(username))))
  const material = await subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
  const master = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, KEY_BYTES * 8))
  const [kek, idKey] = await Promise.all([hkdf(master, 'gollazim-uye|v1|kek'), hkdf(master, 'gollazim-uye|v1|id')])
  master.fill(0)
  return { kek, idKey }
}

async function slotId(idKey: Bytes, publishNonce: Bytes): Promise<Bytes> {
  const key = await subtle().importKey('raw', idKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', key, publishNonce)).slice(0, SLOT_ID_BYTES)
}

/**
 * Başlığın doğrulanan hâli (AES-GCM ek verisi). Sürüm, yayın numarası, yayın zamanı,
 * KDF parametreleri, tuz ve yayın nonce'u buna bağlıdır: biri değişirse paket açılmaz.
 */
const headerBytes = (h: Pick<MemberEnvelope, 'format' | 'v' | 'n' | 'publishedAt' | 'kdf' | 'siteSalt' | 'publishNonce'>): Bytes =>
  utf8(JSON.stringify([h.format, h.v, h.n, h.publishedAt, h.kdf.name, h.kdf.iterations, h.siteSalt, h.publishNonce]))

export interface SealInput {
  payload: MemberPayload
  /** Aktif üyelerin anahtarları; çıkarılan üye bu listede olmaz */
  members: MemberKeys[]
  siteSalt: Uint8Array
  /** Üyelerin anahtarları türetilirken kullanılan iterasyon; başlığa yazılır */
  iterations?: number
  /** Sarmal listesinin sabit uzunluğu */
  slotCount?: number
}

/** Paketi şifreler. Her çağrıda yeni DEK, yeni nonce ve yeni yuva kimlikleri üretilir. */
export async function sealPayload(input: SealInput): Promise<MemberEnvelope> {
  // İzinli olmayan tek bir alan varsa paket şifrelenmez.
  assertMemberPayload(input.payload)
  const iterations = checkIterations(input.iterations ?? KDF_ITERATIONS.default)
  const slotCount = input.slotCount ?? DEFAULT_SLOT_COUNT
  if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > MAX_SLOTS) throw new Error(`Yuva sayısı 1-${MAX_SLOTS} arasında olmalı.`)
  if (input.siteSalt.length !== SITE_SALT_BYTES) throw new Error('siteSalt 16 bayt olmalı.')
  if (input.members.some((m) => m.kek.length !== KEY_BYTES || m.idKey.length !== KEY_BYTES)) throw new Error('Üye anahtarı 32 bayt olmalı.')
  // Üye sayısı sabit uzunluğu aşarsa liste bu uzunluğun katlarına çıkar.
  const total = Math.max(1, Math.ceil(input.members.length / slotCount)) * slotCount
  if (total > MAX_SLOTS) throw new Error(`En fazla ${MAX_SLOTS} üye desteklenir.`)

  const header = {
    format: ENVELOPE_FORMAT,
    v: ENVELOPE_VERSION,
    n: input.payload.n,
    publishedAt: input.payload.publishedAt,
    kdf: { name: KDF_NAME, iterations },
    siteSalt: toBase64(input.siteSalt),
    publishNonce: toBase64(randomBytes(PUBLISH_NONCE_BYTES)),
  } as const
  const publishNonce = fromBase64(header.publishNonce, 'publishNonce')

  const dek = await subtle().generateKey({ name: 'AES-GCM', length: KEY_BYTES * 8 }, true, ['encrypt'])
  const nonce = randomBytes(GCM_NONCE_BYTES)
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: headerBytes(header) }, dek, utf8(JSON.stringify(input.payload))))

  const slots: Bytes[] = []
  for (const member of input.members) {
    const kek = await subtle().importKey('raw', member.kek, 'AES-KW', false, ['wrapKey'])
    const wrapped = new Uint8Array(await subtle().wrapKey('raw', dek, kek, 'AES-KW'))
    slots.push(concat(await slotId(member.idKey, publishNonce), wrapped))
  }
  // Boş yuvalar rastgele baytlarla doldurulur; gerçek yuvadan ayırt edilemez.
  while (slots.length < total) slots.push(randomBytes(SLOT_BYTES))
  for (let i = slots.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }

  return { ...header, nonce: toBase64(nonce), slots: slots.map(toBase64), ciphertext: toBase64(ciphertext) }
}

/**
 * İndirilen paketin dış biçimini denetler (çözmeden). Tam anahtar denetimi, sürüm,
 * iterasyon sınırları ve alan uzunlukları tutmuyorsa MemberEnvelopeError verir.
 */
export function parseEnvelope(value: unknown): MemberEnvelope {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new MemberEnvelopeError('JSON değil')
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MemberEnvelopeError('nesne bekleniyor')
  const e = value as Record<string, unknown>
  const keys = Object.keys(e)
  if (keys.length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((k) => keys.includes(k))) throw new MemberEnvelopeError('alanlar beklenenden farklı')
  if (e.format !== ENVELOPE_FORMAT) throw new MemberEnvelopeError('biçim tanınmıyor')
  if (e.v !== ENVELOPE_VERSION) throw new MemberEnvelopeError('desteklenmeyen sürüm')
  if (typeof e.n !== 'number' || !Number.isInteger(e.n) || e.n < 1) throw new MemberEnvelopeError('yayın numarası geçersiz')
  if (typeof e.publishedAt !== 'string' || e.publishedAt.length > 30 || Number.isNaN(Date.parse(e.publishedAt))) throw new MemberEnvelopeError('yayın zamanı geçersiz')
  const kdf = e.kdf as Record<string, unknown> | null
  if (typeof kdf !== 'object' || kdf === null || Object.keys(kdf).sort().join() !== 'iterations,name') throw new MemberEnvelopeError('kdf geçersiz')
  if (kdf.name !== KDF_NAME) throw new MemberEnvelopeError('desteklenmeyen anahtar türetme yöntemi')
  const iterations = checkIterations(kdf.iterations)
  fromBase64(e.siteSalt, 'siteSalt', SITE_SALT_BYTES)
  fromBase64(e.publishNonce, 'publishNonce', PUBLISH_NONCE_BYTES)
  fromBase64(e.nonce, 'nonce', GCM_NONCE_BYTES)
  if (!Array.isArray(e.slots) || e.slots.length < 1 || e.slots.length > MAX_SLOTS) throw new MemberEnvelopeError('yuva listesi geçersiz')
  e.slots.forEach((slot, i) => fromBase64(slot, `slots[${i}]`, SLOT_BYTES))
  if (typeof e.ciphertext !== 'string' || e.ciphertext.length < 24 || e.ciphertext.length > MAX_CIPHERTEXT_CHARS) throw new MemberEnvelopeError('şifreli metin geçersiz')
  fromBase64(e.ciphertext, 'ciphertext')
  return {
    format: ENVELOPE_FORMAT,
    v: ENVELOPE_VERSION,
    n: e.n,
    publishedAt: e.publishedAt,
    kdf: { name: KDF_NAME, iterations },
    siteSalt: e.siteSalt as string,
    publishNonce: e.publishNonce as string,
    nonce: e.nonce as string,
    slots: e.slots as string[],
    ciphertext: e.ciphertext as string,
  }
}

/**
 * Paketi türetilmiş anahtarlarla açar (PBKDF2 gerekmez: oturum boyunca yeni yayınlar
 * bununla açılır). Yuva yoksa MemberAccessError, paket bozuk ya da değiştirilmişse
 * MemberEnvelopeError verir.
 */
export async function openWithKeys(envelopeInput: unknown, keys: MemberKeys): Promise<MemberPayload> {
  const envelope = parseEnvelope(envelopeInput)
  const id = await slotId(keys.idKey, fromBase64(envelope.publishNonce, 'publishNonce'))
  const slot = envelope.slots.map((s) => fromBase64(s, 'slot')).find((s) => sameBytes(s.subarray(0, SLOT_ID_BYTES), id))
  if (!slot) throw new MemberAccessError('denied')

  let dek: CryptoKey
  try {
    const kek = await subtle().importKey('raw', keys.kek, 'AES-KW', false, ['unwrapKey'])
    dek = await subtle().unwrapKey('raw', slot.slice(SLOT_ID_BYTES), kek, 'AES-KW', 'AES-GCM', false, ['decrypt'])
  } catch {
    throw new MemberAccessError('denied')
  }

  let plain: ArrayBuffer
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.nonce, 'nonce'), additionalData: headerBytes(envelope) }, dek, fromBase64(envelope.ciphertext, 'ciphertext'))
  } catch {
    throw new MemberEnvelopeError('doğrulama başarısız: paket ya da başlık değiştirilmiş')
  }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(plain))
    // Çözülen paket de tam şema denetiminden geçer.
    assertMemberPayload(payload)
  } catch (error) {
    throw new MemberEnvelopeError(error instanceof MemberPayloadError ? error.message : 'paket içeriği okunamadı')
  }
  if (payload.n !== envelope.n || payload.publishedAt !== envelope.publishedAt) throw new MemberEnvelopeError('başlık ile içerik uyuşmuyor')
  return payload
}

/** Girişte: anahtarları paketin başlığındaki parametrelerle türetir ve paketi açar. */
export async function openEnvelope(envelopeInput: unknown, username: string, password: string): Promise<{ payload: MemberPayload; keys: MemberKeys }> {
  // Biçimi tutmayan girdi için ne paket okunur ne türetme yapılır.
  normalizeUsername(username)
  normalizePassword(password)
  const envelope = parseEnvelope(envelopeInput)
  const keys = await deriveMemberKeys({ username, password, siteSalt: fromBase64(envelope.siteSalt, 'siteSalt'), iterations: envelope.kdf.iterations })
  return { payload: await openWithKeys(envelope, keys), keys }
}
