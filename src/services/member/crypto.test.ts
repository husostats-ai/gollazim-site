import { writeFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { memberInput } from './__fixtures__/rawData'
import {
  ACCESS_DENIED_TEXT,
  DEFAULT_SLOT_COUNT,
  deriveMemberKeys,
  ENVELOPE_FORMAT,
  formatPassword,
  fromBase64,
  generatePassword,
  isValidUsername,
  KDF_ITERATIONS,
  MemberAccessError,
  MemberEnvelopeError,
  newSiteSalt,
  normalizePassword,
  normalizeUsername,
  openEnvelope,
  openWithKeys,
  parseEnvelope,
  PASSWORD_ALPHABET,
  randomBytes,
  sealPayload,
  toBase64,
  type MemberEnvelope,
  type MemberKeys,
} from './crypto'
import { buildMemberPayload, type MemberPayload } from './payload'
import { MemberPayloadError } from './schema'

// Testlerde gerçek hiçbir şifre ya da anahtar yoktur: şifreler her çalıştırmada
// rastgele üretilir, biçim testlerindeki metinler sentetiktir.
// PBKDF2 gerçek iterasyonla (600.000) çalışır; bu yüzden türetme sayısı az tutulur.

const SLOW = 60_000
const payload: MemberPayload = buildMemberPayload(memberInput())
const nextPayload: MemberPayload = buildMemberPayload(memberInput({ n: 8, publishedAt: '2026-10-05T15:45:00.000Z' }))
const siteSalt = newSiteSalt()
const passwords = { ayse: generatePassword(), mehmet: generatePassword() }
let ayse: MemberKeys
let mehmet: MemberKeys
let envelope: MemberEnvelope

/** Admin'in sakladığı türden anahtarlar; PBKDF2 çalıştırmadan çok üyeli paket kurmak için */
const syntheticKeys = (count: number): MemberKeys[] => Array.from({ length: count }, () => ({ kek: randomBytes(32), idKey: randomBytes(32) }))
const clone = (e: MemberEnvelope): MemberEnvelope => JSON.parse(JSON.stringify(e)) as MemberEnvelope
/** base64 alanın bir baytını değiştirir */
const flip = (base64: string, index: number): string => {
  const bytes = fromBase64(base64, 'test')
  bytes[index < 0 ? bytes.length + index : index] ^= 1
  return toBase64(bytes)
}
const rejection = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

beforeAll(async () => {
  ;[ayse, mehmet] = await Promise.all([
    deriveMemberKeys({ username: 'ayse', password: passwords.ayse, siteSalt }),
    deriveMemberKeys({ username: 'mehmet', password: passwords.mehmet, siteSalt }),
  ])
  envelope = await sealPayload({ payload, members: [ayse, mehmet], siteSalt })
}, SLOW)

afterEach(() => vi.restoreAllMocks())

describe('şifre üretimi', () => {
  it('XXXX-XXXX-XXXX-XXXX biçiminde, yalnızca karışmayan karakterlerle', () => {
    expect(PASSWORD_ALPHABET).toHaveLength(30)
    for (const ch of '01ILOU') expect(PASSWORD_ALPHABET).not.toContain(ch)
    const samples = Array.from({ length: 300 }, generatePassword)
    for (const p of samples) expect(p).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(new Set(samples).size).toBe(300)
    // Alfabenin her karakteri kullanılıyor.
    expect(new Set(samples.join('').replace(/-/g, '')).size).toBe(30)
    expect(normalizePassword(samples[0])).toBe(samples[0].replace(/-/g, ''))
    expect(formatPassword(normalizePassword(samples[0]))).toBe(samples[0])
  })
})

describe('kullanıcı adı normalizasyonu', () => {
  it('baştaki/sondaki boşluk atılır, küçük harfe çevrilir; . _ - ve rakam serbest', () => {
    expect(normalizeUsername('  Ahmet.K_1-x \n')).toBe('ahmet.k_1-x')
    expect(normalizeUsername('AYSE')).toBe('ayse')
    // ASCII büyük I, küçük i olur (yerel dile bağlı değil).
    expect(normalizeUsername('ISMAIL')).toBe('ismail')
    expect(isValidUsername('ayse.k')).toBe(true)
    expect(isValidUsername('Ayse')).toBe(false)
  })

  it('ASCII dışı karakter dönüştürülmez, reddedilir (Türkçe İ / ı / ş / ğ …)', () => {
    for (const name of ['İsmail', 'ISMAİL', 'ısmail', 'şule', 'çağrı', 'gökhan', 'öznur', 'ümit', 'ayşe', 'aysé', 'ａｙｓｅ'])
      expect(() => normalizeUsername(name), name).toThrow(MemberAccessError)
  })

  it('izinli olmayan karakter, iç boşluk, çok kısa ya da çok uzun ad reddedilir', () => {
    for (const name of ['', '  ', 'ab', 'ahmet k', 'ahmet@site', 'ahmet/k', '-ahmet', '.ahmet', 'a'.repeat(33), 'ahmet\tk'])
      expect(() => normalizeUsername(name), JSON.stringify(name)).toThrow(MemberAccessError)
  })
})

describe('şifre normalizasyonu', () => {
  const plain = 'ABCDEFGHJKMNPQRS'

  it('boşluk ve tireler atılır, büyük harfe çevrilir', () => {
    expect(normalizePassword('ABCD-EFGH-JKMN-PQRS')).toBe(plain)
    expect(normalizePassword('abcd-efgh-jkmn-pqrs')).toBe(plain)
    expect(normalizePassword('  abcd efgh  jkmn pqrs\n')).toBe(plain)
    expect(normalizePassword('abcdefghjkmnpqrs')).toBe(plain)
    // Kopyala-yapıştırda gelen uzun tire, eksi işareti ve bölünmez boşluk
    expect(normalizePassword('ABCD–EFGH—JKMN−PQRS ')).toBe(plain)
    expect(normalizePassword('2345-6789-wxyz-tvrs')).toBe('23456789WXYZTVRS')
  })

  it('alfabede olmayan karakter reddedilir: 0 1 I L O U', () => {
    for (const ch of '01ILOUilou') expect(() => normalizePassword(`${ch}BCD-EFGH-JKMN-PQRS`), ch).toThrow(MemberAccessError)
  })

  it('Türkçe klavye karakterleri reddedilir; benzer ASCII harfe çevrilmez', () => {
    // "ı" büyütülünce "I", "i" büyütülünce (Türkçe yerelde) "İ" olur: ikisi de alfabede yoktur.
    for (const ch of ['ı', 'İ', 'i', 'I', 'ş', 'Ş', 'ğ', 'Ğ', 'ç', 'Ç', 'ö', 'Ö', 'ü', 'Ü', 'ß', 'é', 'Ａ'])
      expect(() => normalizePassword(`${ch}BCD-EFGH-JKMN-PQRS`), ch).toThrow(MemberAccessError)
  })

  it('uzunluğu tutmayan ya da başka işaret içeren metin reddedilir', () => {
    for (const text of ['', '    ', 'ABCD-EFGH-JKMN-PQR', 'ABCD-EFGH-JKMN-PQRSS', 'ABCD_EFGH_JKMN_PQRS', 'ABCD.EFGH.JKMN.PQRS', 'ABCD-EFGH-JKMN-PQR!'])
      expect(() => normalizePassword(text), JSON.stringify(text)).toThrow(MemberAccessError)
  })

  it('biçimi tutmayan girişte türetme hiç çalışmaz ve hata genel mesajı taşır', async () => {
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    for (const [username, password] of [
      ['ayse', 'ABCD-EFGH-JKMN-PQRı'],
      ['ayse', 'kısa'],
      ['ayşe', passwords.ayse],
      ['İsmail', passwords.ayse],
    ]) {
      const error = await rejection(openEnvelope(envelope, username, password))
      expect(error).toBeInstanceOf(MemberAccessError)
      expect((error as MemberAccessError).kind).toBe('format')
      expect((error as Error).message).toBe(ACCESS_DENIED_TEXT)
    }
    expect(deriveBits).not.toHaveBeenCalled()
  })
})

describe('gidiş-dönüş', () => {
  it('üye kullanıcı adı ve şifresiyle paketi açar; içerik birebir aynıdır', async () => {
    const opened = await openEnvelope(JSON.stringify(envelope), 'ayse', passwords.ayse)
    expect(opened.payload).toEqual(payload)
    expect(JSON.stringify(opened.payload)).toBe(JSON.stringify(payload))
    expect(opened.keys).toEqual(ayse)
    // Oturum boyunca türetilmiş anahtarlarla (PBKDF2'siz) açılır.
    expect(await openWithKeys(envelope, mehmet)).toEqual(payload)
  }, SLOW)

  it('girişte kullanıcı adı ve şifre normalize edilir: büyük/küçük harf, boşluk, tire fark etmez', async () => {
    const messy = `  ${passwords.ayse.toLowerCase().replace(/-/g, ' ')}  `
    expect((await openEnvelope(envelope, '  AySe ', messy)).payload).toEqual(payload)
  }, SLOW)

  it('türetilen iki anahtar birbirinden ve başka kullanıcının anahtarlarından farklıdır', async () => {
    expect(ayse.kek).toHaveLength(32)
    expect(ayse.idKey).toHaveLength(32)
    expect(toBase64(ayse.kek)).not.toBe(toBase64(ayse.idKey))
    // Aynı şifre, başka kullanıcı adı ya da başka site tuzu: anahtarlar değişir (tuz kullanıcı adından türetilir).
    const [otherUser, otherSite] = await Promise.all([
      deriveMemberKeys({ username: 'zeynep', password: passwords.ayse, siteSalt }),
      deriveMemberKeys({ username: 'ayse', password: passwords.ayse, siteSalt: newSiteSalt() }),
    ])
    for (const other of [otherUser, otherSite]) {
      expect(toBase64(other.kek)).not.toBe(toBase64(ayse.kek))
      expect(toBase64(other.idKey)).not.toBe(toBase64(ayse.idKey))
    }
  }, SLOW)
})

describe('yanlış giriş', () => {
  it('yanlış şifre ve yanlış kullanıcı adı aynı genel hatayı verir', async () => {
    const wrongPassword = await rejection(openEnvelope(envelope, 'ayse', generatePassword()))
    const wrongUser = await rejection(openEnvelope(envelope, 'ayse2', passwords.ayse))
    const swapped = await rejection(openEnvelope(envelope, 'ayse', passwords.mehmet))
    for (const error of [wrongPassword, wrongUser, swapped]) {
      expect(error).toBeInstanceOf(MemberAccessError)
      expect((error as MemberAccessError).kind).toBe('denied')
      expect((error as Error).message).toBe(ACCESS_DENIED_TEXT)
    }
  }, SLOW)

  it('listede olmayan anahtarla paket açılmaz', async () => {
    expect(await rejection(openWithKeys(envelope, syntheticKeys(1)[0]))).toBeInstanceOf(MemberAccessError)
    // Kimliği tutan ama sarma anahtarı yanlış olan üye de açamaz.
    expect(await rejection(openWithKeys(envelope, { idKey: ayse.idKey, kek: mehmet.kek }))).toBeInstanceOf(MemberAccessError)
  })
})

describe('bozulmuş paket', () => {
  it('şifreli metnin ya da doğrulama etiketinin tek biti değişirse reddedilir', async () => {
    for (const index of [0, 100, -1]) {
      const broken = { ...clone(envelope), ciphertext: flip(envelope.ciphertext, index) }
      expect(await rejection(openWithKeys(broken, ayse)), `bayt ${index}`).toBeInstanceOf(MemberEnvelopeError)
    }
  })

  it('nonce değişirse reddedilir', async () => {
    expect(await rejection(openWithKeys({ ...clone(envelope), nonce: flip(envelope.nonce, 3) }, ayse))).toBeInstanceOf(MemberEnvelopeError)
  })

  it('yuvalar bozulursa kimse açamaz; kısaltılmış şifreli metin reddedilir', async () => {
    const brokenSlots = { ...clone(envelope), slots: envelope.slots.map((s) => flip(s, 30)) }
    expect(await rejection(openWithKeys(brokenSlots, ayse))).toBeInstanceOf(MemberAccessError)
    const bytes = fromBase64(envelope.ciphertext, 'test')
    const truncated = { ...clone(envelope), ciphertext: toBase64(bytes.subarray(0, bytes.length - 16)) }
    expect(await rejection(openWithKeys(truncated, ayse))).toBeInstanceOf(MemberEnvelopeError)
  })

  it('başka bir yayının yuvaları bu yayının içeriğini açmaz', async () => {
    const other = await sealPayload({ payload: nextPayload, members: [ayse], siteSalt })
    const mixed = { ...clone(envelope), slots: other.slots, publishNonce: other.publishNonce }
    expect(await rejection(openWithKeys(mixed, ayse))).toBeInstanceOf(MemberEnvelopeError)
  })

  it('dış biçimi tutmayan paket çözülmeden reddedilir', () => {
    const bad: unknown[] = [
      'json değil',
      '[]',
      null,
      { ...clone(envelope), ek: 1 },
      (({ ciphertext: _, ...rest }) => rest)(clone(envelope)),
      { ...clone(envelope), format: 'baska-paket' },
      { ...clone(envelope), v: 2 },
      { ...clone(envelope), n: 0 },
      { ...clone(envelope), publishedAt: 'dün' },
      { ...clone(envelope), siteSalt: 'AAAA' },
      { ...clone(envelope), nonce: toBase64(randomBytes(16)) },
      { ...clone(envelope), slots: [] },
      { ...clone(envelope), slots: [toBase64(randomBytes(55))] },
      { ...clone(envelope), slots: Array.from({ length: 1025 }, () => envelope.slots[0]) },
      { ...clone(envelope), ciphertext: 'base64 değil!' },
      { ...clone(envelope), kdf: { name: 'PBKDF2-SHA1', iterations: 600_000 } },
      { ...clone(envelope), kdf: { name: 'PBKDF2-SHA256', iterations: 600_000, ek: true } },
    ]
    for (const value of bad) expect(() => parseEnvelope(value), JSON.stringify(value)?.slice(0, 60)).toThrow(MemberEnvelopeError)
    expect(parseEnvelope(JSON.stringify(envelope))).toEqual(envelope)
  })
})

describe('değiştirilmiş başlık', () => {
  it('başlığın her alanı doğrulanır: yayın no, zaman, iterasyon ya da tuz değişirse paket açılmaz', async () => {
    const changes: Partial<MemberEnvelope>[] = [
      { n: envelope.n + 1 },
      { publishedAt: '2026-10-05T06:31:00.000Z' },
      { kdf: { name: 'PBKDF2-SHA256', iterations: envelope.kdf.iterations + 1 } },
      { kdf: { name: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS.max } },
      { siteSalt: flip(envelope.siteSalt, 0) },
    ]
    for (const change of changes) {
      // Anahtarlar doğru olsa bile (yuva bulunur, DEK açılır) içerik doğrulaması başarısız olur.
      expect(await rejection(openWithKeys({ ...clone(envelope), ...change }, ayse)), JSON.stringify(change)).toBeInstanceOf(MemberEnvelopeError)
    }
    // Yayın nonce'u değişirse yuva kimlikleri tutmaz.
    expect(await rejection(openWithKeys({ ...clone(envelope), publishNonce: flip(envelope.publishNonce, 0) }, ayse))).toBeInstanceOf(MemberAccessError)
    // Değişmemiş paket hâlâ açılıyor.
    expect(await openWithKeys(clone(envelope), ayse)).toEqual(payload)
  })
})

describe('iterasyon sınırları', () => {
  it('sınırlar: en az 600.000, en çok 2.000.000', () => {
    expect(KDF_ITERATIONS).toEqual({ min: 600_000, default: 600_000, max: 2_000_000 })
  })

  it('sınır dışı ya da tam sayı olmayan iterasyonlu paket reddedilir ve türetme hiç çalışmaz', async () => {
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    for (const iterations of [1, 1000, 100_000, 599_999, 2_000_001, 1_000_000_000, 600_000.5, -600_000, Number.NaN, '600000', null]) {
      const weak = { ...clone(envelope), kdf: { name: 'PBKDF2-SHA256', iterations } }
      expect(() => parseEnvelope(weak), String(iterations)).toThrow(MemberEnvelopeError)
      expect(await rejection(openEnvelope(weak, 'ayse', passwords.ayse)), String(iterations)).toBeInstanceOf(MemberEnvelopeError)
    }
    expect(deriveBits).not.toHaveBeenCalled()
    // Sınır değerlerin kendisi geçerlidir.
    for (const iterations of [600_000, 2_000_000]) expect(parseEnvelope({ ...clone(envelope), kdf: { name: 'PBKDF2-SHA256', iterations } }).kdf.iterations).toBe(iterations)
  })

  it('zayıf iterasyonla ne anahtar türetilir ne paket şifrelenir', async () => {
    expect(await rejection(deriveMemberKeys({ username: 'ayse', password: passwords.ayse, siteSalt, iterations: 10_000 }))).toBeInstanceOf(MemberEnvelopeError)
    expect(await rejection(sealPayload({ payload, members: [ayse], siteSalt, iterations: 10_000 }))).toBeInstanceOf(MemberEnvelopeError)
  })
})

describe('üye çıkarma', () => {
  it('çıkarılan üye yeni yayını açamaz; eski yayını açabilir, kalan üye ikisini de açar', async () => {
    const after = await sealPayload({ payload: nextPayload, members: [ayse], siteSalt })
    const denied = await rejection(openWithKeys(after, mehmet))
    expect(denied).toBeInstanceOf(MemberAccessError)
    expect((denied as Error).message).toBe(ACCESS_DENIED_TEXT)
    expect(await openWithKeys(envelope, mehmet)).toEqual(payload)
    expect(await openWithKeys(after, ayse)).toEqual(nextPayload)
    expect(await openWithKeys(envelope, ayse)).toEqual(payload)
  })

  it('şifresi yenilenen üyenin eski anahtarları yeni yayını açmaz', async () => {
    const renewed = syntheticKeys(1)[0]
    const after = await sealPayload({ payload: nextPayload, members: [ayse, renewed], siteSalt })
    expect(await rejection(openWithKeys(after, mehmet))).toBeInstanceOf(MemberAccessError)
    expect(await openWithKeys(after, renewed)).toEqual(nextPayload)
  })
})

describe('her yayın yenidir; sarmal listesi opak ve sabit uzunluktadır', () => {
  it('aynı içerik iki kez şifrelenince anahtar, nonce, yuva kimlikleri ve şifreli metin tümüyle değişir', async () => {
    const again = await sealPayload({ payload, members: [ayse, mehmet], siteSalt })
    expect(again.nonce).not.toBe(envelope.nonce)
    expect(again.publishNonce).not.toBe(envelope.publishNonce)
    expect(again.ciphertext).not.toBe(envelope.ciphertext)
    // Hiçbir yuva (kimliğiyle ya da sarmalıyla) iki yayında ortak değildir.
    const ids = (e: MemberEnvelope) => e.slots.map((s) => toBase64(fromBase64(s, 'test').subarray(0, 16)))
    const wraps = (e: MemberEnvelope) => e.slots.map((s) => toBase64(fromBase64(s, 'test').subarray(16)))
    expect(ids(again).filter((id) => ids(envelope).includes(id))).toEqual([])
    expect(wraps(again).filter((w) => wraps(envelope).includes(w))).toEqual([])
    expect(new Set(ids(again)).size).toBe(DEFAULT_SLOT_COUNT)
    // Değişmeyen tek şey sitenin tuzudur.
    expect(again.siteSalt).toBe(envelope.siteSalt)
    expect(fromBase64(again.nonce, 'test')).toHaveLength(12)
  })

  it('liste üye sayısından bağımsız olarak 64 yuvadır; her yuva 56 bayttır', async () => {
    expect(DEFAULT_SLOT_COUNT).toBe(64)
    for (const count of [0, 1, 2, 50, 64]) {
      const sealed = await sealPayload({ payload, members: syntheticKeys(count), siteSalt })
      expect(sealed.slots, `${count} üye`).toHaveLength(64)
      for (const slot of sealed.slots) expect(fromBase64(slot, 'test')).toHaveLength(56)
    }
  })

  it('uzunluk ayarlanabilir; üye sayısı aşarsa liste uzunluğun katına çıkar', async () => {
    expect((await sealPayload({ payload, members: syntheticKeys(3), siteSalt, slotCount: 8 })).slots).toHaveLength(8)
    expect((await sealPayload({ payload, members: syntheticKeys(9), siteSalt, slotCount: 8 })).slots).toHaveLength(16)
    const many = syntheticKeys(65)
    const sealed = await sealPayload({ payload, members: many, siteSalt })
    expect(sealed.slots).toHaveLength(128)
    expect(await openWithKeys(sealed, many[64])).toEqual(payload)
    expect(await rejection(sealPayload({ payload, members: [], siteSalt, slotCount: 0 }))).toBeInstanceOf(Error)
  })

  it('gerçek yuvalar listenin başında toplanmaz (karıştırılır)', async () => {
    const members = syntheticKeys(4)
    const positions = new Set<number>()
    for (let i = 0; i < 12; i++) {
      const sealed = await sealPayload({ payload, members, siteSalt })
      // Sahte yuvalar rastgeledir; gerçek yuvanın yeri, onu çıkarınca paketin açılmamasından bulunur.
      for (let slot = 0; slot < sealed.slots.length; slot++) {
        const without = { ...sealed, slots: sealed.slots.map((s, j) => (j === slot ? toBase64(randomBytes(56)) : s)) }
        if ((await rejection(openWithKeys(without, members[0]))) instanceof MemberAccessError) positions.add(slot)
      }
    }
    expect(positions.size).toBeGreaterThan(6)
    expect(Math.max(...positions)).toBeGreaterThan(3)
  }, SLOW)

  it('paketin açık kısmında kullanıcı adı, içerik ya da alan adı yoktur', () => {
    const text = JSON.stringify(envelope)
    expect(Object.keys(envelope).sort()).toEqual(['ciphertext', 'format', 'kdf', 'n', 'nonce', 'publishNonce', 'publishedAt', 'siteSalt', 'slots', 'v'])
    expect(envelope.format).toBe(ENVELOPE_FORMAT)
    for (const word of ['ayse', 'mehmet', 'Kuzey', 'Deneme Ligi', 'percent', 'statistics', 'disclaimer']) expect(text).not.toContain(word)
    expect(envelope.n).toBe(payload.n)
    expect(envelope.publishedAt).toBe(payload.publishedAt)
  })

  it('izinli olmayan alan taşıyan paket şifrelenmez', async () => {
    const leaky = { ...payload, stats: { Odds_Home_Win: 1.737 } } as unknown as MemberPayload
    expect(await rejection(sealPayload({ payload: leaky, members: [ayse], siteSalt }))).toBeInstanceOf(MemberPayloadError)
  })
})

describe('50 kullanıcı: paket boyutu ve süre', () => {
  it('50 üyeli paket: yuvalar ~5 KB ekler; şifreleme ve açma anlıktır', async () => {
    const members = [...syntheticKeys(49), ayse]
    const plainBytes = new TextEncoder().encode(JSON.stringify(payload)).length

    const sealStart = performance.now()
    const sealed = await sealPayload({ payload, members, siteSalt })
    const sealMs = performance.now() - sealStart
    const text = JSON.stringify(sealed)
    const envelopeBytes = new TextEncoder().encode(text).length
    const slotBytes = JSON.stringify(sealed.slots).length

    const openStart = performance.now()
    expect(await openWithKeys(text, ayse)).toEqual(payload)
    const openMs = performance.now() - openStart

    expect(sealed.slots).toHaveLength(64)
    // 64 yuva x 56 bayt, base64 ve JSON ayraçlarıyla
    expect(slotBytes).toBeLessThan(5200)
    // Toplam: base64 şişmesi (4/3) + yuvalar + başlık
    expect(envelopeBytes).toBeLessThan(Math.ceil((plainBytes + 16) * 4 / 3) + slotBytes + 400)
    expect(sealMs).toBeLessThan(2000)
    expect(openMs).toBeLessThan(2000)

    // UYE_OLCUM=dosya: ölçümü yazar; ayrıca 50 kullanıcının anahtarlarını gerçekten türetir.
    if (process.env.UYE_OLCUM) {
      const one = performance.now()
      await deriveMemberKeys({ username: 'olcum', password: generatePassword(), siteSalt })
      const deriveMs = performance.now() - one
      const all = performance.now()
      for (let i = 0; i < 50; i++) await deriveMemberKeys({ username: `uye${i}`, password: generatePassword(), siteSalt })
      const createMs = performance.now() - all
      // UYE_PAKET=dosya: gerçek veriden üretilmiş düz paket (bkz. leak.test.ts, UYE_OUT) de ölçülür.
      const real: string[] = []
      if (process.env.UYE_PAKET) {
        const { readFileSync } = await import('node:fs')
        const realPayload = JSON.parse(readFileSync(process.env.UYE_PAKET, 'utf8')) as MemberPayload
        const realSealed = JSON.stringify(await sealPayload({ payload: realPayload, members, siteSalt }))
        real.push(`gerçek veriyle: düz ${JSON.stringify(realPayload).length} bayt → şifreli ${realSealed.length} bayt`)
      }
      writeFileSync(
        process.env.UYE_OLCUM,
        [
          ...real,
          `düz paket: ${plainBytes} bayt`,
          `şifreli paket (50 üye, 64 yuva): ${envelopeBytes} bayt (yuvalar ${slotBytes} bayt)`,
          `yayın (şifreleme + 50 sarma): ${sealMs.toFixed(0)} ms`,
          `açma (türetilmiş anahtarla): ${openMs.toFixed(0)} ms`,
          `tek anahtar türetme (PBKDF2 600.000): ${deriveMs.toFixed(0)} ms`,
          `50 kullanıcı oluşturma (sıralı): ${(createMs / 1000).toFixed(1)} sn`,
        ].join('\n') + '\n',
      )
    }
  }, 180_000)
})
