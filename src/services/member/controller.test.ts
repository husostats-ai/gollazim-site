import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { memberInput } from './__fixtures__/rawData'
import { createMemberController, type MemberController, type MemberState } from './controller'
import { deriveMemberKeys, fromBase64, generatePassword, newSiteSalt, randomBytes, sealPayload, toBase64, type MemberEnvelope, type MemberKeys } from './crypto'
import { buildMemberPayload, type MemberPayload } from './payload'
import { loadSession, saveSession, touchSession, type SessionStore } from './session'
import { MEMBER_SESSION_KEY } from './sessionFlag'
import { fetchEnvelope, MemberSourceError, withTimestamp, type FetchLike } from './source'

// Üye sayfasının durum akışı: gerçek şifreleme, sahte ağ ve bellekteki oturum deposuyla.
// Şifreler her çalıştırmada rastgele üretilir.

const SLOW = 60_000
const URL = '/yayin/paket.json'
const HOUR = 3_600_000
const IDLE = 12 * HOUR
const START = Date.parse('2026-10-05T07:00:00.000Z')

const payload: MemberPayload = buildMemberPayload(memberInput())
const newer: MemberPayload = buildMemberPayload(memberInput({ n: 8, publishedAt: '2026-10-05T15:45:00.000Z' }))
const siteSalt = newSiteSalt()
const password = generatePassword()
let keys: MemberKeys
let envelope: MemberEnvelope
let newerEnvelope: MemberEnvelope
let revokedEnvelope: MemberEnvelope

beforeAll(async () => {
  keys = await deriveMemberKeys({ username: 'deneme', password, siteSalt })
  const others: MemberKeys[] = Array.from({ length: 3 }, () => ({ kek: randomBytes(32), idKey: randomBytes(32) }))
  envelope = await sealPayload({ payload, members: [...others, keys], siteSalt })
  newerEnvelope = await sealPayload({ payload: newer, members: [keys, ...others], siteSalt })
  revokedEnvelope = await sealPayload({ payload: newer, members: others, siteSalt })
}, SLOW)

afterEach(() => vi.restoreAllMocks())

const memoryStore = (): SessionStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

type Reply = { status?: number; body?: string } | 'offline'

function setup(initial: Reply | MemberEnvelope, store = memoryStore()) {
  const world = { now: START, reply: initial as Reply | MemberEnvelope, requests: [] as { url: string; init: unknown }[] }
  const fetchImpl: FetchLike = async (url, init) => {
    world.requests.push({ url, init })
    const reply = world.reply
    if (reply === 'offline') throw new TypeError('Failed to fetch')
    if ('format' in reply) return { ok: true, status: 200, text: async () => JSON.stringify(reply) }
    const status = reply.status ?? 200
    return { ok: status >= 200 && status < 300, status, text: async () => reply.body ?? '' }
  }
  const controller: MemberController = createMemberController({ url: URL, fetchImpl, store, now: () => world.now, idleMs: IDLE })
  return { controller, store, world }
}

const signedOut = (state: MemberState) => {
  if (state.status !== 'signedOut') throw new Error(`beklenen: signedOut, gelen: ${state.status}`)
  return state
}
const signedIn = (state: MemberState) => {
  if (state.status !== 'signedIn') throw new Error(`beklenen: signedIn, gelen: ${state.status}`)
  return state
}

describe('giriş', () => {
  it('oturum yokken giriş ekranı; doğru bilgilerle paket açılır', async () => {
    const { controller, store, world } = setup(envelope)
    expect(controller.getState().status).toBe('starting')
    await controller.start()
    expect(signedOut(controller.getState())).toEqual({ status: 'signedOut', busy: false, error: null, notice: null })
    expect(world.requests).toHaveLength(0)

    const seen: string[] = []
    controller.subscribe(() => {
      const s = controller.getState()
      seen.push(s.status === 'signedOut' && s.busy ? 'busy' : s.status)
    })
    await controller.login('deneme', password)
    expect(signedIn(controller.getState()).payload).toEqual(payload)
    // Türetme sürerken arayüz "meşgul" durumunu görür.
    expect(seen).toEqual(['busy', 'signedIn'])
    expect(store.data.has(MEMBER_SESSION_KEY)).toBe(true)
  }, SLOW)

  it('paket adresi zaman damgasıyla ve önbelleksiz istenir; başka hiçbir adrese gidilmez', async () => {
    const { controller, world } = setup(envelope)
    await controller.login('deneme', password)
    expect(world.requests).toEqual([{ url: `${URL}?t=${START}`, init: { cache: 'no-store', credentials: 'omit' } }])
    expect(withTimestamp('/a.json?x=1', 5)).toBe('/a.json?x=1&t=5')
  }, SLOW)

  it('dağınık yazılmış kullanıcı adı ve şifre kabul edilir', async () => {
    const { controller } = setup(envelope)
    await controller.login('  DeNeMe ', ` ${password.toLowerCase().replace(/-/g, ' ')} `)
    expect(signedIn(controller.getState()).payload.n).toBe(payload.n)
  }, SLOW)

  it('yanlış şifre: genel hata, oturum kaydedilmez', async () => {
    const { controller, store } = setup(envelope)
    await controller.login('deneme', generatePassword())
    expect(signedOut(controller.getState())).toEqual({ status: 'signedOut', busy: false, error: 'credentials', notice: null })
    expect(store.data.size).toBe(0)
  }, SLOW)

  it('biçimi tutmayan girişte ne paket indirilir ne türetme yapılır', async () => {
    const { controller, world } = setup(envelope)
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    for (const [username, pass] of [['deneme', 'kısa'], ['deneme', 'ABCD-EFGH-JKMN-PQRı'], ['İsmail', password], ['', '']]) {
      await controller.login(username, pass)
      expect(signedOut(controller.getState()).error).toBe('credentials')
    }
    expect(world.requests).toHaveLength(0)
    expect(deriveBits).not.toHaveBeenCalled()
  })

  it('şifre ve kullanıcı adı oturum deposuna yazılmaz; yalnızca türetilmiş anahtar ve zaman yazılır', async () => {
    const { controller, store } = setup(envelope)
    await controller.login('deneme', password)
    const raw = store.data.get(MEMBER_SESSION_KEY)!
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(['at', 'idKey', 'kek'])
    expect(raw).not.toContain(password)
    expect(raw).not.toContain(password.replace(/-/g, ''))
    expect(raw).not.toContain('deneme')
    expect([...store.data.keys()]).toEqual([MEMBER_SESSION_KEY])
  }, SLOW)
})

describe('hata durumları ayrı ayrı bildirilir', () => {
  const cases: [string, Reply | (() => unknown), string][] = [
    ['ağ hatası', 'offline', 'network'],
    ['sunucu hatası', { status: 503 }, 'network'],
    ['paket yok (404)', { status: 404, body: 'Not Found' }, 'missing'],
    ['paket yok (sunucu HTML sayfası döndürüyor)', { body: '<!doctype html><html></html>' }, 'missing'],
    ['bozuk paket (JSON değil)', { body: 'bu bir paket değil' }, 'invalid'],
    ['bozuk paket (alan eksik)', { body: JSON.stringify({ format: 'gollazim-uye-paket' }) }, 'invalid'],
    ['eski sayfa (yeni sürüm paket)', () => ({ body: JSON.stringify({ ...envelope, v: 2 }) }), 'outdated'],
    ['zayıf iterasyonlu paket', () => ({ body: JSON.stringify({ ...envelope, kdf: { name: 'PBKDF2-SHA256', iterations: 1000 } }) }), 'invalid'],
  ]
  it.each(cases)('%s', async (_, reply, kind) => {
    const { controller, store } = setup(typeof reply === 'function' ? (reply() as Reply) : reply)
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    await controller.login('deneme', password)
    expect(signedOut(controller.getState()).error).toBe(kind)
    expect(deriveBits).not.toHaveBeenCalled()
    expect(store.data.size).toBe(0)
  })

  it('çözülemeyen paket: içerik doğrulanamazsa "corrupt"', async () => {
    const bytes = fromBase64(envelope.ciphertext, 'test')
    bytes[40] ^= 1
    const { controller } = setup({ ...envelope, ciphertext: toBase64(bytes) })
    await controller.login('deneme', password)
    expect(signedOut(controller.getState()).error).toBe('corrupt')
  }, SLOW)

  it('fetchEnvelope hata türleri', async () => {
    const reject: FetchLike = async () => Promise.reject(new Error('x'))
    await expect(fetchEnvelope(URL, reject, 1)).rejects.toMatchObject({ kind: 'network' })
    await expect(fetchEnvelope(URL, async () => ({ ok: false, status: 404, text: async () => '' }), 1)).rejects.toBeInstanceOf(MemberSourceError)
    await expect(fetchEnvelope(URL, async () => ({ ok: true, status: 200, text: async () => JSON.stringify(envelope) }), 1)).resolves.toEqual(envelope)
  })
})

describe('oturum', () => {
  it('sayfa yeniden açılınca oturum şifre sorulmadan ve PBKDF2 çalışmadan sürer', async () => {
    const first = setup(envelope)
    await first.controller.login('deneme', password)
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    const second = setup(envelope, first.store)
    await second.controller.start()
    expect(signedIn(second.controller.getState()).payload).toEqual(payload)
    expect(deriveBits).not.toHaveBeenCalled()
  }, SLOW)

  it('sekme kapanınca (depo boşalınca) oturum biter', async () => {
    const first = setup(envelope)
    await first.controller.login('deneme', password)
    const fresh = setup(envelope) // yeni sekme: boş sessionStorage
    await fresh.controller.start()
    expect(signedOut(fresh.controller.getState()).error).toBeNull()
  }, SLOW)

  it('12 saat hareketsizlikte oturum kapanır; işlem yapıldıkça süre uzar', async () => {
    const { controller, store, world } = setup(envelope)
    store.setItem(MEMBER_SESSION_KEY, '') // önce geçersiz kayıt: sessizce silinir
    await controller.start()
    saveSession(store, keys, world.now)
    const resumed = setup(envelope, store)
    resumed.world.now = START
    await resumed.controller.start()
    expect(resumed.controller.getState().status).toBe('signedIn')

    resumed.world.now = START + 11 * HOUR
    resumed.controller.checkIdle()
    expect(resumed.controller.getState().status).toBe('signedIn')
    resumed.controller.touch() // 11. saatte işlem
    resumed.world.now = START + 22 * HOUR
    resumed.controller.checkIdle()
    expect(resumed.controller.getState().status).toBe('signedIn')

    resumed.world.now = START + 23 * HOUR // son işlemden 12 saat sonra
    resumed.controller.checkIdle()
    expect(signedOut(resumed.controller.getState())).toEqual({ status: 'signedOut', busy: false, error: null, notice: 'expired' })
    expect(store.data.size).toBe(0)
  })

  it('süresi dolmuş kayıtla açılan sayfa giriş ister', async () => {
    const store = memoryStore()
    saveSession(store, keys, START - IDLE)
    const { controller, world } = setup(envelope, store)
    await controller.start()
    expect(controller.getState().status).toBe('signedOut')
    expect(store.data.size).toBe(0)
    expect(world.requests).toHaveLength(0)
  })

  it('oturum deposu: bozuk ya da ileri tarihli kayıt geçersizdir', () => {
    const store = memoryStore()
    saveSession(store, keys, START)
    expect(loadSession(store, START + HOUR, IDLE)).toEqual(keys)
    touchSession(store, START + HOUR)
    expect(loadSession(store, START + IDLE + HOUR - 1, IDLE)).toEqual(keys)
    expect(loadSession(store, START + IDLE + HOUR, IDLE)).toBeNull()
    store.setItem(MEMBER_SESSION_KEY, JSON.stringify({ kek: 'AAAA', idKey: 'AAAA', at: START }))
    expect(loadSession(store, START, IDLE)).toBeNull()
    saveSession(store, keys, START + 2 * HOUR)
    expect(loadSession(store, START, IDLE)).toBeNull()
    expect(store.data.size).toBe(0)
  })
})

describe('çıkış', () => {
  it('anahtarı ve çözülmüş veriyi bellekten ve depodan siler', async () => {
    const { controller, store, world } = setup(envelope)
    await controller.login('deneme', password)
    const before = world.requests.length
    controller.logout()
    const state = signedOut(controller.getState())
    expect(state).toEqual({ status: 'signedOut', busy: false, error: null, notice: null })
    expect('payload' in state).toBe(false)
    expect(store.data.size).toBe(0)
    // Çıkıştan sonra yenileme ve hareketsizlik denetimi hiçbir şey yapmaz.
    await controller.refresh()
    controller.touch()
    controller.checkIdle()
    expect(world.requests).toHaveLength(before)
    expect(store.data.size).toBe(0)
    expect(controller.getState().status).toBe('signedOut')
  }, SLOW)
})

describe('yeni yayın', () => {
  it('aynı oturumda yeni yayın PBKDF2 çalışmadan, türetilmiş anahtarla açılır', async () => {
    const { controller, world } = setup(envelope)
    await controller.login('deneme', password)
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')

    // Aynı yayın: durum değişmez.
    const same = controller.getState()
    await controller.refresh()
    expect(controller.getState()).toBe(same)

    world.reply = newerEnvelope
    world.now += 5 * 60_000
    await controller.refresh()
    const state = signedIn(controller.getState())
    expect(state.payload).toEqual(newer)
    expect(state.payload.n).toBe(8)
    expect(deriveBits).not.toHaveBeenCalled()
    expect(world.requests.at(-1)!.url).toBe(`${URL}?t=${world.now}`)
  }, SLOW)

  it('yeni yayında erişimi kalkan üyenin oturumu kapanır', async () => {
    const { controller, store, world } = setup(envelope)
    await controller.login('deneme', password)
    world.reply = revokedEnvelope
    await controller.refresh()
    expect(signedOut(controller.getState())).toEqual({ status: 'signedOut', busy: false, error: null, notice: 'revoked' })
    expect(store.data.size).toBe(0)
  }, SLOW)

  it('yenileme sırasında ağ kesilirse eldeki veri kalır; düzelince uyarı kalkar', async () => {
    const { controller, store, world } = setup(envelope)
    await controller.login('deneme', password)
    world.reply = 'offline'
    await controller.refresh()
    expect(signedIn(controller.getState())).toMatchObject({ refreshError: 'network', payload: { n: payload.n } })
    expect(store.data.size).toBe(1)
    world.reply = envelope
    await controller.refresh()
    expect(signedIn(controller.getState()).refreshError).toBeNull()
  }, SLOW)

  it('sayfa açılışında erişimi kalkmış oturum kapanır; ağ sorununda "Yeniden dene" ile sürer', async () => {
    const store = memoryStore()
    saveSession(store, keys, START)
    const revoked = setup(revokedEnvelope, store)
    await revoked.controller.start()
    expect(signedOut(revoked.controller.getState()).notice).toBe('revoked')

    saveSession(store, keys, START)
    const offline = setup('offline', store)
    await offline.controller.start()
    expect(signedOut(offline.controller.getState())).toEqual({ status: 'signedOut', busy: false, error: 'network', notice: null, resumable: true })
    // Geçici sorunda kayıt silinmez: "Yeniden dene" oturumu şifre sorulmadan sürdürür.
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    await offline.controller.retry()
    expect(signedOut(offline.controller.getState())).toMatchObject({ error: 'network', resumable: true })
    offline.world.reply = envelope
    await offline.controller.retry()
    expect(signedIn(offline.controller.getState()).payload).toEqual(payload)
    expect(deriveBits).not.toHaveBeenCalled()
    // Sayfa yenilenince de oturum sürer.
    const back = setup(envelope, store)
    await back.controller.start()
    expect(back.controller.getState().status).toBe('signedIn')
  })

  it('kayıtlı oturum yokken "Yeniden dene" sunulmaz; giriş hatası yeniden denemeyle silinir', async () => {
    const { controller, world } = setup('offline')
    await controller.login('deneme', password)
    const failed = signedOut(controller.getState())
    expect(failed.error).toBe('network')
    expect(failed.resumable).toBeUndefined()
    const before = world.requests.length
    await controller.retry()
    expect(signedOut(controller.getState())).toEqual({ status: 'signedOut', busy: false, error: null, notice: null })
    expect(world.requests).toHaveLength(before)
  })
})
