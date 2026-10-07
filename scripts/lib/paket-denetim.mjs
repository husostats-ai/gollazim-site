// Yayınlanacak dosyanın ŞİFRELİ bir üye yayın paketi olduğunu denetler (içeriği çözmeden).
// Düz/şifresiz paket, normal JSON yedek ya da üye anahtar yedeği yanlışlıkla yayınlanmasın
// diye yayın komutu (scripts/yayinla.mjs) dosyayı önce buradan geçirir.
// Kurallar src/services/member/crypto.ts içindeki parseEnvelope ile aynıdır.

export const PACKAGE_FORMAT = 'gollazim-uye-paket'
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024
const KEYS = ['format', 'v', 'n', 'publishedAt', 'kdf', 'siteSalt', 'publishNonce', 'nonce', 'slots', 'ciphertext']
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
/** Düz pakette, yedekte ya da anahtar yedeğinde bulunan okunabilir alan adları */
const PLAIN_MARKERS = ['"days"', '"lists"', '"matches"', '"statistics"', '"percent"', '"categoryId"', '"home"', '"away"', '"texts"', '"picks"', '"results"', '"uploads"', '"stats"', '"members"', '"kek"', '"idKey"', '"password"', '"sifre"']

const bytesOf = (value) => (typeof value === 'string' && BASE64.test(value) ? Buffer.from(value, 'base64') : null)

/**
 * Dosya metnini denetler. Sorun yoksa { ok: true, n, publishedAt, slots, bytes },
 * varsa { ok: false, problems: [...] } döner.
 */
export function checkPackageText(text) {
  const problems = []
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_PACKAGE_BYTES) problems.push(`dosya çok büyük (${bytes} bayt; sınır ${MAX_PACKAGE_BYTES})`)
  if (bytes < 400) problems.push('dosya bir yayın paketi olamayacak kadar küçük')
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, problems: [...problems, 'dosya JSON değil'] }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, problems: [...problems, 'beklenen biçimde değil (nesne değil)'] }

  // Başka türden dosyalar: açık adıyla reddedilir.
  if (data.app === 'gollazim') problems.push('bu bir normal veri yedeği (HAM VERİ içerir); yayınlanamaz')
  if (data.format === 'gollazim-uye-anahtar') problems.push('bu bir üye anahtar yedeği; yayınlanamaz')
  if ('days' in data || 'statistics' in data || 'texts' in data) problems.push('bu DÜZ (şifresiz) bir paket; yayınlanamaz')
  const markers = PLAIN_MARKERS.filter((marker) => text.includes(marker))
  if (markers.length > 0) problems.push(`dosyada okunabilir (şifresiz) alanlar var: ${markers.join(', ')}`)

  const keys = Object.keys(data)
  const extra = keys.filter((k) => !KEYS.includes(k))
  const missing = KEYS.filter((k) => !keys.includes(k))
  if (extra.length > 0) problems.push(`beklenmeyen alan: ${extra.join(', ')}`)
  if (missing.length > 0) problems.push(`eksik alan: ${missing.join(', ')}`)
  if (problems.length > 0) return { ok: false, problems }

  if (data.format !== PACKAGE_FORMAT) problems.push('biçim imi tanınmıyor')
  if (data.v !== 1) problems.push('desteklenmeyen paket sürümü')
  if (!Number.isInteger(data.n) || data.n < 1) problems.push('yayın numarası geçersiz')
  if (typeof data.publishedAt !== 'string' || Number.isNaN(Date.parse(data.publishedAt))) problems.push('yayın zamanı geçersiz')
  const kdf = data.kdf
  if (typeof kdf !== 'object' || kdf === null || Object.keys(kdf).sort().join() !== 'iterations,name' || kdf.name !== 'PBKDF2-SHA256') problems.push('anahtar türetme parametreleri geçersiz')
  else if (!Number.isInteger(kdf.iterations) || kdf.iterations < 600_000 || kdf.iterations > 2_000_000) problems.push('PBKDF2 iterasyonu 600.000-2.000.000 aralığında değil')
  if (bytesOf(data.siteSalt)?.length !== 16) problems.push('site tuzu geçersiz')
  if (bytesOf(data.publishNonce)?.length !== 16) problems.push('yayın nonce değeri geçersiz')
  if (bytesOf(data.nonce)?.length !== 12) problems.push('nonce geçersiz')
  if (!Array.isArray(data.slots) || data.slots.length < 1 || data.slots.length > 1024 || data.slots.some((s) => bytesOf(s)?.length !== 56)) problems.push('sarmal listesi geçersiz')
  const body = bytesOf(data.ciphertext)
  if (!body || body.length < 64) problems.push('şifreli gövde geçersiz')
  else {
    // Şifreli gövde rastgele görünür: okunabilir metin (JSON, sözcükler) içeren gövde şifresizdir.
    const printable = body.filter((b) => b === 9 || b === 10 || (b >= 32 && b < 127)).length / body.length
    if (printable > 0.6) problems.push('gövde şifreli görünmüyor (okunabilir metin içeriyor)')
    if (new Set(body).size < 200 && body.length > 2000) problems.push('gövde şifreli görünmüyor (bayt dağılımı tekdüze değil)')
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, n: data.n, publishedAt: data.publishedAt, slots: data.slots.length, bytes }
}
