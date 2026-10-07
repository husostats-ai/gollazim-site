import type { MemberTexts } from '../../config/memberTexts'
import { deriveMemberKeys, fromBase64, generatePassword, MemberAccessError, newSiteSalt, normalizeUsername, toBase64, type MemberKeys } from '../member/crypto'
import type { MemberRecord } from './types'

// Üye kayıtları üzerindeki işlemler. Veri deposuna dokunmaz: kayıt alır, kayıt döner.
// Düz şifre yalnızca üretildiği anda çağırana döner; hiçbir kayda yazılmaz.

/** Üretildiği an elde olan, bir kez gösterilen giriş bilgisi */
export interface IssuedLogin {
  username: string
  /** XXXX-XXXX-XXXX-XXXX */
  password: string
}

export type UsernameProblem = 'format' | 'taken'

export const USERNAME_PROBLEM_TEXTS: Record<UsernameProblem, string> = {
  format: 'Kullanıcı adı 3-32 karakter olmalı; yalnızca a-z, 0-9 ve . _ - kullanılabilir (Türkçe harf ve boşluk olmaz), harf ya da rakamla başlamalı.',
  taken: 'Bu kullanıcı adı zaten var (çıkarılmış üyelerin adı yeniden kullanılmaz).',
}

/**
 * Yeni kullanıcı adını denetler: biçim (ASCII küçük harf, rakam, . _ -) ve benzersizlik.
 * Baştaki/sondaki boşluk atılır, büyük harf küçültülür. Çıkarılmış üyelerin adı da doludur.
 */
export function checkNewUsername(input: string, existing: readonly string[]): { ok: true; username: string } | { ok: false; problem: UsernameProblem } {
  let username: string
  try {
    username = normalizeUsername(input)
  } catch (error) {
    if (error instanceof MemberAccessError) return { ok: false, problem: 'format' }
    throw error
  }
  return existing.includes(username) ? { ok: false, problem: 'taken' } : { ok: true, username }
}

export interface BulkParse {
  usernames: string[]
  rejected: { line: number; text: string; problem: UsernameProblem }[]
}

/** Her satırda bir kullanıcı adı. Boş satırlar atlanır; listede yinelenen ad "dolu" sayılır. */
export function parseBulkUsernames(text: string, existing: readonly string[]): BulkParse {
  const usernames: string[] = []
  const rejected: BulkParse['rejected'] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '') return
    const checked = checkNewUsername(raw, [...existing, ...usernames])
    if (checked.ok) usernames.push(checked.username)
    else rejected.push({ line: index + 1, text: raw.trim(), problem: checked.problem })
  })
  return { usernames, rejected }
}

const keysOf = async (username: string, password: string, siteSalt: string): Promise<Pick<MemberRecord, 'kek' | 'idKey'>> => {
  const keys = await deriveMemberKeys({ username, password, siteSalt: fromBase64(siteSalt, 'siteSalt', 16) })
  return { kek: toBase64(keys.kek), idKey: toBase64(keys.idKey) }
}

/** Sitenin tuzu yoksa üretir (base64) */
export const ensureSiteSalt = (current: string | null): string => current ?? toBase64(newSiteSalt())

/** Yeni üye: rastgele şifre üretir, anahtarları türetir (yavaş). Şifre kayda yazılmaz. */
export async function createMember(username: string, siteSalt: string, now: string): Promise<{ record: MemberRecord; issued: IssuedLogin }> {
  const password = generatePassword()
  const keys = await keysOf(username, password, siteSalt)
  return { record: { username, kek: keys.kek, idKey: keys.idKey, active: true, createdAt: now }, issued: { username, password } }
}

/**
 * Birden çok üye. Türetmeler sırayla beklenir (tarayıcıda arayüz kilitlenmez);
 * her üyeden sonra onProgress çağrılır.
 */
export async function createMembers(usernames: readonly string[], siteSalt: string, now: string, onProgress?: (done: number, total: number) => void): Promise<{ records: MemberRecord[]; issued: IssuedLogin[] }> {
  const records: MemberRecord[] = []
  const issued: IssuedLogin[] = []
  for (const username of usernames) {
    const created = await createMember(username, siteSalt, now)
    records.push(created.record)
    issued.push(created.issued)
    onProgress?.(records.length, usernames.length)
  }
  return { records, issued }
}

/** Aktif üyeye yeni şifre: eski anahtarlar silinir. Yeniden yayınlanana dek eski şifre yayındaki paketi açar. */
export async function renewPassword(record: MemberRecord, siteSalt: string, now: string): Promise<{ record: MemberRecord; issued: IssuedLogin }> {
  if (!record.active) throw new Error('Çıkarılmış üyenin şifresi yenilenmez; yeni hesap açın.')
  const password = generatePassword()
  const keys = await keysOf(record.username, password, siteSalt)
  return { record: { username: record.username, kek: keys.kek, idKey: keys.idKey, active: true, createdAt: record.createdAt, renewedAt: now }, issued: { username: record.username, password } }
}

/** Üyeyi çıkarır: anahtarları kayıttan silinir, sonraki yayınlara eklenmez. Kayıt (ad, tarih) kalır. */
export const removeMember = (record: MemberRecord, now: string): MemberRecord => ({
  username: record.username,
  kek: null,
  idKey: null,
  active: false,
  createdAt: record.createdAt,
  ...(record.renewedAt !== undefined && { renewedAt: record.renewedAt }),
  removedAt: now,
})

export const activeMembers = (records: readonly MemberRecord[]): MemberRecord[] => records.filter((r) => r.active && r.kek !== null && r.idKey !== null)

/** Yayına girecek anahtarlar: yalnızca aktif üyeler */
export const activeKeys = (records: readonly MemberRecord[]): MemberKeys[] =>
  activeMembers(records).map((r) => ({ kek: fromBase64(r.kek, 'kek', 32), idKey: fromBase64(r.idKey, 'idKey', 32) }))

/** Üyeye gönderilecek hesap bilgi mesajı */
export const accountMessage = (issued: IssuedLogin, texts: MemberTexts, siteUrl: string): string =>
  ['GOLLAZIM üye girişi', '', `Adres: ${siteUrl}`, `Kullanıcı adı: ${issued.username}`, `Şifre: ${issued.password}`, '', texts.account, texts.disclaimer].join('\n')

/** Dağıtım listesi (CSV): "kullanıcı adı;şifre". ŞİFRE İÇERİR; dağıtımdan sonra silinmelidir. */
export const distributionCsv = (issued: readonly IssuedLogin[]): string => ['kullanici_adi;sifre', ...issued.map((i) => `${i.username};${i.password}`)].join('\r\n') + '\r\n'

export const distributionFileName = (today: string): string => `gollazim-uye-dagitim-${today}.csv`
