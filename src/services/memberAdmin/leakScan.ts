import { TEXT_FIELDS } from '../../config/columnAliases'
import type { Match } from '../../types'
import type { MemberPayload } from '../member/payload'
import { assertMemberPayload, MEMBER_KEYS, MemberPayloadError } from '../member/schema'

// Yayın anındaki sızıntı denetimi: paketin düz hâli, o günlerin GERÇEK ham verisine
// karşı taranır. Tek bir bulguda paket indirilmez.

export interface LeakScan {
  /** Bulgular; boşsa denetim geçti */
  problems: string[]
  /** Karşılaştırılan ham değer sayısı */
  checked: number
}

const IDENTITY_FIELDS: readonly string[] = TEXT_FIELDS
const ALLOWED_KEYS = new Set<string>(Object.values(MEMBER_KEYS).flat())

function walk(value: unknown, keys: Set<string>, numbers: Set<number>, strings: string[], path: string): void {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, numbers, strings, path))
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      keys.add(k)
      walk(v, keys, numbers, strings, `${path}.${k}`)
    }
  else if (typeof value === 'number') numbers.add(value)
  // Uyarı metinleri admin'in yazdığı serbest metindir; ham veri taramasının dışındadır.
  else if (typeof value === 'string' && !path.startsWith('.texts')) strings.push(value)
}

/**
 * Paketi şemaya ve ham veriye karşı denetler:
 * - tam anahtar denetimi (izinli olmayan tek alan bulgu sayılır),
 * - ham istatistik anahtarlarının ve CSV başlıklarının adı geçmiyor,
 * - iki ve daha çok ondalıklı hiçbir ham sayı (oran, xG, ortalama) pakette yok,
 * - kimlik metinleri dışındaki ham metinler (bağlantı vb.) ve maç kimlikleri pakette yok.
 */
export function scanForLeaks(payload: MemberPayload, rawMatches: readonly Match[]): LeakScan {
  const problems: string[] = []
  try {
    assertMemberPayload(payload)
  } catch (error) {
    problems.push(error instanceof MemberPayloadError ? error.message : 'Şema denetimi başarısız.')
  }
  const keys = new Set<string>()
  const numbers = new Set<number>()
  const strings: string[] = []
  walk(payload, keys, numbers, strings, '')
  for (const key of keys) if (!ALLOWED_KEYS.has(key)) problems.push(`izinli olmayan alan: ${key}`)

  const text = JSON.stringify(payload)
  const data = strings.join('\n')
  if (/footystats/i.test(text)) problems.push('kaynak adı geçiyor')
  if (/https?:\/\/|www\./i.test(data)) problems.push('bağlantı geçiyor')

  let checked = 0
  const seenKeys = new Set<string>()
  for (const match of rawMatches) {
    if (data.includes(match.id)) problems.push('maç kimliği geçiyor')
    for (const [key, value] of Object.entries(match.stats)) {
      // Kısa ve gündelik anahtarlar (time, home…) takım ya da lig adında geçebilir; taranmaz.
      if (key.length >= 9 && !seenKeys.has(key)) {
        seenKeys.add(key)
        if (text.includes(key)) problems.push(`ham alan adı geçiyor: ${key}`)
      }
      if (typeof value === 'number' && !Number.isInteger(value * 10)) {
        checked++
        if (numbers.has(value)) problems.push(`ham sayı geçiyor: ${key}`)
      } else if (typeof value === 'string' && value.length >= 16 && !IDENTITY_FIELDS.includes(key)) {
        checked++
        if (data.includes(value)) problems.push(`ham metin geçiyor: ${key}`)
      }
    }
  }
  return { problems: [...new Set(problems)], checked }
}
