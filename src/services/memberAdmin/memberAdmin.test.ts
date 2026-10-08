import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MEMBER_TEXTS, normalizeMemberTexts } from '../../config/memberTexts'
import { MEMBER_SITE_URL } from '../../config/member'
import type { Match } from '../../types'
import { shiftDate } from '../../utils/format'
import { assembleBackup } from '../data/backupFormat'
import type { MemberAdminRepo } from '../data/types'
import { DAY, dayMatches, LEAGUE_TABLES, MARKET_LIMIT, MATCHES, PICKS, PREVIOUS_DAY, RESULTS, SHARED, THRESHOLDS } from '../member/__fixtures__/rawData'
import { generatePassword, MemberAccessError, openEnvelope, openWithKeys, PASSWORD_ALPHABET, type MemberKeys } from '../member/crypto'
import type { MemberPayload } from '../member/payload'
import { assertMemberPayload } from '../member/schema'
import { addMembers, backupMemberKeys, previewPublication, publish, removeMemberByName, renewMemberPassword, restoreMemberKeys, saveMemberTexts } from './actions'
import { checkPassphrase, KEY_BACKUP_FORMAT, KeyBackupError, openKeyBackup, parseKeyBackup, sealKeyBackup, type KeyBackupFile } from './keyBackup'
import { scanForLeaks } from './leakScan'
import { PUBLISH_DAY_COUNT, PublishError, summarizePayload, type PublishSources } from './publish'
import { accountMessage, activeKeys, activeMembers, checkNewUsername, distributionCsv, distributionFileName, parseBulkUsernames, removeMember, USERNAME_PROBLEM_TEXTS, type IssuedLogin } from './registry'
import { keyBackupStatus } from './reminder'
import type { MemberMeta, MemberRecord, MemberSnapshot, PublicationRecord } from './types'

// Admin tarafı: üye yönetimi, yayın ve üye anahtar yedeği. Gerçek şifreleme (600.000
// iterasyon) kullanılır; veri deposu ve maç verisi bellektedir. Şifre ve parolalar
// her çalıştırmada rastgele üretilir ya da sentetiktir.

const SLOW = 240_000
const T0 = '2026-10-05T06:00:00.000Z'
const T1 = '2026-10-05T07:00:00.000Z'
const T2 = '2026-10-05T08:00:00.000Z'
const T3 = '2026-10-05T09:00:00.000Z'

/** Bellekteki üye kayıt deposu; Dexie uygulamasının davranışını taklit eder */
function memoryRepo(): MemberAdminRepo & { state: { members: Map<string, MemberRecord>; meta: MemberMeta; publications: PublicationRecord[] } } {
  const state = { members: new Map<string, MemberRecord>(), meta: { siteSalt: null, publishCounter: 0, texts: DEFAULT_MEMBER_TEXTS, keysChangedAt: null, lastKeyBackupAt: null } as MemberMeta, publications: [] as PublicationRecord[] }
  return {
    state,
    listMembers: async () => [...state.members.values()].sort((a, b) => a.username.localeCompare(b.username)).map((m) => ({ ...m })),
    putMembers: async (records) => records.forEach((r) => void state.members.set(r.username, { ...r })),
    getMeta: async () => ({ ...state.meta }),
    patchMeta: async (patch) => {
      state.meta = { ...state.meta, ...patch, ...(patch.texts && { texts: normalizeMemberTexts(patch.texts) }) }
    },
    listPublications: async () => [...state.publications].sort((a, b) => b.n - a.n),
    addPublication: async (record) => void state.publications.push(record),
    restore: async (snapshot, restoredAt) => {
      state.members = new Map(snapshot.members.map((m) => [m.username, m]))
      state.publications = [...snapshot.publications]
      state.meta = { siteSalt: snapshot.siteSalt, publishCounter: snapshot.publishCounter, texts: snapshot.texts, keysChangedAt: restoredAt, lastKeyBackupAt: restoredAt }
    },
  }
}

const sources = (matches: Match[] = MATCHES): PublishSources => ({
  listMatchesByDate: async (date) => matches.filter((m) => m.date === date),
  listResultsByMatchIds: async (ids) => RESULTS.filter((r) => ids.includes(r.matchId)),
  listPicks: async () => PICKS,
  listShared: async () => SHARED,
  listLeagueTables: async () => LEAGUE_TABLES,
  listAliases: async () => [],
  getThresholds: async () => THRESHOLDS,
  getMarketConflictLimit: async () => MARKET_LIMIT,
})

const rejection = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)
const keysOf = (repo: ReturnType<typeof memoryRepo>, username: string): MemberKeys => activeKeys([repo.state.members.get(username)!])[0]

afterEach(() => vi.restoreAllMocks())

describe('kullanıcı adı denetimi', () => {
  it('ASCII kuralı: küçük harf, rakam ve . _ -; boşluk atılır, büyük harf küçültülür', () => {
    expect(checkNewUsername('  Ahmet.K_1-x ', [])).toEqual({ ok: true, username: 'ahmet.k_1-x' })
    for (const bad of ['', 'ab', 'ahmet k', 'İsmail', 'ısmail', 'şule', 'ahmet@x', '-ahmet', 'a'.repeat(33)]) expect(checkNewUsername(bad, []), bad).toEqual({ ok: false, problem: 'format' })
    expect(USERNAME_PROBLEM_TEXTS.format).toContain('Türkçe harf')
  })

  it('aynı ad reddedilir: büyük/küçük harf farkı ve çıkarılmış üyenin adı da doludur', () => {
    expect(checkNewUsername('ayse', ['ayse'])).toEqual({ ok: false, problem: 'taken' })
    expect(checkNewUsername(' AYSE ', ['ayse'])).toEqual({ ok: false, problem: 'taken' })
    const removed = removeMember({ username: 'eski', kek: 'x', idKey: 'y', active: true, createdAt: T0 }, T1)
    expect(checkNewUsername('eski', [removed.username])).toEqual({ ok: false, problem: 'taken' })
  })

  it('toplu liste: boş satırlar atlanır; geçersiz, dolu ve yinelenen adlar satır numarasıyla reddedilir', () => {
    const parsed = parseBulkUsernames(' Ali \n\nveli\nALI\nşule\nayse\n  \nx\r\nzeynep.k\r\n', ['ayse'])
    expect(parsed.usernames).toEqual(['ali', 'veli', 'zeynep.k'])
    expect(parsed.rejected).toEqual([
      { line: 4, text: 'ALI', problem: 'taken' },
      { line: 5, text: 'şule', problem: 'format' },
      { line: 6, text: 'ayse', problem: 'taken' },
      { line: 8, text: 'x', problem: 'format' },
    ])
  })
})

describe('üye ekleme', () => {
  const repo = memoryRepo()
  let issued: IssuedLogin[]

  beforeAll(async () => {
    issued = await addMembers(repo, ['ayse', 'mehmet'], T0)
  }, SLOW)

  it('şifre XXXX-XXXX-XXXX-XXXX biçiminde, karışmayan alfabeyle ve her üyede farklı üretilir', () => {
    expect(issued.map((i) => i.username)).toEqual(['ayse', 'mehmet'])
    for (const { password } of issued) {
      expect(password).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/)
      expect([...password.replace(/-/g, '')].every((ch) => PASSWORD_ALPHABET.includes(ch))).toBe(true)
    }
    expect(issued[0].password).not.toBe(issued[1].password)
  })

  it('düz şifre hiçbir kayda yazılmaz: yalnızca türetilmiş anahtarlar saklanır', () => {
    const stored = JSON.stringify([...repo.state.members.values(), repo.state.meta])
    for (const { password } of issued) {
      expect(stored).not.toContain(password)
      expect(stored).not.toContain(password.replace(/-/g, ''))
    }
    expect(Object.keys(repo.state.members.get('ayse')!).sort()).toEqual(['active', 'createdAt', 'idKey', 'kek', 'username'])
    expect(repo.state.members.get('ayse')).toMatchObject({ active: true, createdAt: T0 })
    expect(repo.state.meta.siteSalt).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(repo.state.meta.keysChangedAt).toBe(T0)
  })

  it('var olan ya da geçersiz adla ekleme reddedilir ve hiçbir şey kaydedilmez', async () => {
    const deriveBits = vi.spyOn(globalThis.crypto.subtle, 'deriveBits')
    for (const names of [['ayse'], ['yeni', 'yeni'], ['Büyük'], ['şule'], ['tamam', 'ayse']]) expect(await rejection(addMembers(repo, names, T1)), names.join()).toBeInstanceOf(Error)
    expect(deriveBits).not.toHaveBeenCalled()
    expect([...repo.state.members.keys()]).toEqual(['ayse', 'mehmet'])
  })

  it('hesap bilgi mesajı: adres, kullanıcı adı, şifre ve iki uyarı', () => {
    const message = accountMessage(issued[0], DEFAULT_MEMBER_TEXTS, MEMBER_SITE_URL)
    // Üyelere ayrı üye sitesinin adresi verilir; admin sitesinin adresi mesajda geçmez.
    expect(message.split('\n')).toContain('Adres: https://husostats-ai.github.io/gollazim-uye/')
    expect(MEMBER_SITE_URL).toBe('https://husostats-ai.github.io/gollazim-uye/')
    expect(message).not.toContain('gollazim-site')
    expect(message).toContain('Kullanıcı adı: ayse')
    expect(message).toContain(`Şifre: ${issued[0].password}`)
    expect(message).toContain('Hesap kişiye özeldir, paylaşılamaz.')
    expect(message).toContain(DEFAULT_MEMBER_TEXTS.disclaimer)
  })

  it('dağıtım listesi: "kullanıcı adı;şifre" satırları; dosya adı repoya girmeyen desende', () => {
    expect(distributionCsv(issued)).toBe(`kullanici_adi;sifre\r\nayse;${issued[0].password}\r\nmehmet;${issued[1].password}\r\n`)
    expect(distributionFileName('2026-10-05')).toBe('gollazim-uye-dagitim-2026-10-05.csv')
    const ignore = readFileSync('.gitignore', 'utf8').split('\n')
    for (const line of ['*.csv', 'gollazim-uye-*', 'dagitim*', 'paket.json']) expect(ignore, line).toContain(line)
  })

  it('yayın: paket seçilen günü ve önerisi olan önceki günleri içerir; üyeler kendi şifreleriyle açar', async () => {
    const draft = await previewPublication(repo, sources(), DAY, T1)
    expect(draft.payload.n).toBe(1)
    expect(summarizePayload(draft.payload).days.map((d) => d.date)).toEqual([DAY, PREVIOUS_DAY])
    expect(repo.state.meta.publishCounter).toBe(0) // önizleme kaydetmez

    const first = await publish(repo, sources(), DAY, T1)
    expect(first.record).toMatchObject({ n: 1, publishedAt: T1, day: DAY, memberCount: 2 })
    expect(first.record.bytes).toBe(new TextEncoder().encode(first.text).length)
    expect(first.envelope.slots).toHaveLength(64)
    expect(first.leakChecked).toBeGreaterThan(400)
    expect(first.summary.days[0]).toMatchObject({ date: DAY, matches: dayMatches(DAY).length })
    expect(first.summary.days[0].items).toBeGreaterThan(40)
    for (const { username, password } of issued) expect((await openEnvelope(first.text, username, password)).payload.days.map((d) => d.date)).toEqual([DAY, PREVIOUS_DAY])
    // İndirilen dosyanın açık kısmında içerik ve kullanıcı adı yoktur.
    for (const word of ['ayse', 'mehmet', 'Kuzey', 'percent']) expect(first.text).not.toContain(word)
  }, SLOW)

  describe('son 7 gün', () => {
    /** Seçilen günün maçları, verilen kadar gün geriye taşınmış hâliyle (kimlik tarihi içerir) */
    const shifted = (back: number): Match[] => {
      const date = shiftDate(DAY, -back)
      return dayMatches(DAY).map((m) => ({ ...m, id: m.id.replace(DAY, date), date }))
    }
    const datesOf = (payload: MemberPayload) => payload.days.map((d) => d.date)
    const itemsOf = (payload: MemberPayload) => payload.days.map((d) => d.lists.reduce((sum, l) => sum + l.items.length, 0))

    it('her günde öneri varsa seçilen gün ve önceki 6 gün girer, daha eskisi girmez; paket şemadan ve sızıntı denetiminden geçer', async () => {
      const matches = [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(shifted)
      expect(new Set(matches.map((m) => m.id)).size).toBe(matches.length)
      const draft = await previewPublication(memoryRepo(), sources(matches), DAY, T1)
      expect(PUBLISH_DAY_COUNT).toBe(7)
      expect(datesOf(draft.payload)).toEqual([0, 1, 2, 3, 4, 5, 6].map((back) => shiftDate(DAY, -back)))
      for (const count of itemsOf(draft.payload)) expect(count).toBeGreaterThan(40)
      expect(() => assertMemberPayload(JSON.parse(JSON.stringify(draft.payload)))).not.toThrow()
      expect(scanForLeaks(draft.payload, draft.rawMatches).problems).toEqual([])
      expect(new Set(draft.rawMatches.map((m) => m.date))).toEqual(new Set(datesOf(draft.payload)))
    })

    it('hiç önerisi olmayan önceki günler atlanır (maçı olmayan gün ve maçı olup önerisi çıkmayan gün)', async () => {
      // 3 gün önce: maç var ama hiçbir listeye girmiyor (önceki günün tek maçından yüzdeler silinmiş hâli).
      const bare: Match[] = dayMatches(PREVIOUS_DAY).map((m) => ({ ...m, id: m.id.replace(PREVIOUS_DAY, shiftDate(DAY, -3)), date: shiftDate(DAY, -3), stats: {} }))
      const draft = await previewPublication(memoryRepo(), sources([...shifted(0), ...shifted(2), ...bare, ...shifted(5)]), DAY, T1)
      expect(datesOf(draft.payload)).toEqual([DAY, shiftDate(DAY, -2), shiftDate(DAY, -5)])
      expect(itemsOf(draft.payload).every((count) => count > 0)).toBe(true)
      expect(new Set(draft.rawMatches.map((m) => m.date))).toEqual(new Set([DAY, shiftDate(DAY, -2), shiftDate(DAY, -5)]))
    })

    it('seçilen gün boş olsa da pakete girer ve ilk sırada kalır', async () => {
      const tomorrow = shiftDate(DAY, 1)
      const draft = await previewPublication(memoryRepo(), sources(), tomorrow, T1)
      expect(datesOf(draft.payload)).toEqual([tomorrow, DAY, PREVIOUS_DAY])
      expect(itemsOf(draft.payload)[0]).toBe(0)
      // Hiç veri yokken de: yalnızca seçilen gün.
      expect(datesOf((await previewPublication(memoryRepo(), sources([]), DAY, T1)).payload)).toEqual([DAY])
    })
  })

  it('yayın numarası artar ve geçmişe yalnızca özet yazılır (içerik tutulmaz)', async () => {
    const second = await publish(repo, sources(), DAY, T2)
    expect(second.record.n).toBe(2)
    expect(repo.state.meta.publishCounter).toBe(2)
    const history = await repo.listPublications()
    expect(history.map((h) => h.n)).toEqual([2, 1])
    expect(Object.keys(history[0]).sort()).toEqual(['bytes', 'day', 'memberCount', 'n', 'publishedAt'])
    expect(JSON.stringify(history)).not.toContain('Kuzey')
  })

  it('kaydedilen uyarı metinleri yayına girer', async () => {
    await saveMemberTexts(repo, { disclaimer: '  Özel yasal uyarı.  ', account: 'Özel hesap notu.' })
    const publication = await publish(repo, sources(), DAY, T2)
    const payload = await openWithKeys(publication.text, keysOf(repo, 'ayse'))
    expect(payload.texts).toEqual({ disclaimer: 'Özel yasal uyarı.', account: 'Özel hesap notu.' })
    // Boş bırakılan metin varsayılana döner.
    await saveMemberTexts(repo, { disclaimer: '', account: '' })
    expect(repo.state.meta.texts).toEqual(DEFAULT_MEMBER_TEXTS)
  })

  it('çıkar + yeniden yayınla: çıkarılan üye yeni paketi açamaz, eskisini açar', async () => {
    const before = await publish(repo, sources(), DAY, T2)
    const mehmetKeys = keysOf(repo, 'mehmet')
    await removeMemberByName(repo, 'mehmet', T3)
    expect(repo.state.members.get('mehmet')).toEqual({ username: 'mehmet', kek: null, idKey: null, active: false, createdAt: T0, removedAt: T3 })
    expect(repo.state.meta.keysChangedAt).toBe(T3)

    const after = await publish(repo, sources(), DAY, T3)
    expect(after.record).toMatchObject({ n: before.record.n + 1, memberCount: 1 })
    expect(await rejection(openEnvelope(after.text, 'mehmet', issued[1].password))).toBeInstanceOf(MemberAccessError)
    expect(await rejection(openWithKeys(after.text, mehmetKeys))).toBeInstanceOf(MemberAccessError)
    expect((await openWithKeys(before.text, mehmetKeys)).n).toBe(before.record.n)
    expect((await openEnvelope(after.text, 'ayse', issued[0].password)).payload.n).toBe(after.record.n)
    // Çıkarılan üye yeniden etkinleştirilemez, şifresi yenilenemez, adı yeniden kullanılamaz.
    expect(await rejection(renewMemberPassword(repo, 'mehmet', T3))).toBeInstanceOf(Error)
    expect(await rejection(removeMemberByName(repo, 'mehmet', T3))).toBeInstanceOf(Error)
    expect(await rejection(addMembers(repo, ['mehmet'], T3))).toBeInstanceOf(Error)
  }, SLOW)

  it('şifre yenileme: eski şifre yeni pakette çalışmaz, yeni şifre çalışır; şifre yine saklanmaz', async () => {
    const oldPassword = issued[0].password
    const renewed = await renewMemberPassword(repo, 'ayse', T3)
    expect(renewed.username).toBe('ayse')
    expect(renewed.password).not.toBe(oldPassword)
    expect(renewed.password).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(repo.state.members.get('ayse')).toMatchObject({ active: true, createdAt: T0, renewedAt: T3 })
    expect(JSON.stringify([...repo.state.members.values()])).not.toContain(renewed.password)

    const publication = await publish(repo, sources(), DAY, T3)
    expect(await rejection(openEnvelope(publication.text, 'ayse', oldPassword))).toBeInstanceOf(MemberAccessError)
    expect((await openEnvelope(publication.text, 'ayse', renewed.password)).payload.n).toBe(publication.record.n)
  }, SLOW)
})

describe('yayın: boş üye ve sızıntı denetimi', () => {
  it('aktif üye yoksa uyarır; paket üretilmez, sayaç artmaz', async () => {
    const empty = memoryRepo()
    const error = await rejection(publish(empty, sources(), DAY, T1))
    expect(error).toBeInstanceOf(PublishError)
    expect((error as PublishError).kind).toBe('no-members')
    expect((error as Error).message).toContain('Aktif üye yok')
    expect(empty.state.meta.publishCounter).toBe(0)
    expect(empty.state.publications).toEqual([])

    // Tek üye çıkarıldıktan sonra da aynı.
    const one = memoryRepo()
    one.state.meta.siteSalt = 'AAAAAAAAAAAAAAAAAAAAAA=='
    one.state.members.set('eski', removeMember({ username: 'eski', kek: 'x', idKey: 'y', active: true, createdAt: T0 }, T1))
    expect(((await rejection(publish(one, sources(), DAY, T1))) as PublishError).kind).toBe('no-members')
    expect(activeMembers([...one.state.members.values()])).toEqual([])
  })

  it('temiz paket sızıntı denetiminden geçer; ham veriyle gerçekten karşılaştırılır', async () => {
    const draft = await previewPublication(memoryRepo(), sources(), DAY, T1)
    const scan = scanForLeaks(draft.payload, draft.rawMatches)
    expect(scan.problems).toEqual([])
    expect(scan.checked).toBeGreaterThan(400)
    expect(draft.rawMatches.map((m) => m.date).sort()).toEqual([...dayMatches(PREVIOUS_DAY), ...dayMatches(DAY)].map((m) => m.date).sort())
  })

  it('pakete ham değer, ham alan, bağlantı ya da izinli olmayan alan girerse denetim bulgu verir', async () => {
    const draft = await previewPublication(memoryRepo(), sources(), DAY, T1)
    const raw = draft.rawMatches[0]
    const tamper = (change: (p: MemberPayload) => void): string[] => {
      const copy = JSON.parse(JSON.stringify(draft.payload)) as MemberPayload
      change(copy)
      return scanForLeaks(copy, draft.rawMatches).problems
    }
    const withExtra = (extra: Record<string, unknown>) => tamper((p) => Object.assign(p.days[0].matches[0], extra))
    expect(withExtra({ stats: raw.stats }).join(' ')).toMatch(/izinli olmayan alan/)
    expect(withExtra({ odds: raw.stats.oddsHome }).join(' ')).toMatch(/ham sayı geçiyor: oddsHome/)
    expect(tamper((p) => void (p.days[0].matches[0].league = String(raw.stats['Match FootyStats URL']))).join(' ')).toMatch(/kaynak adı|bağlantı|ham metin/)
    expect(tamper((p) => void (p.days[0].matches[0].home = raw.id)).join(' ')).toMatch(/maç kimliği/)
    expect(tamper((p) => void (p.days[0].matches[0].league = 'Odds_BTTS_Yes')).join(' ')).toMatch(/ham alan adı geçiyor/)
    expect(tamper((p) => void (p.days[0].lists[0].items[0].percent = Number(raw.stats.homeXg))).join(' ')).toMatch(/ham sayı geçiyor: homeXg/)
    // Admin'in yazdığı uyarı metni serbesttir; adres içerse de bulgu sayılmaz.
    expect(tamper((p) => void (p.texts.account = 'Soru için: https://t.me/ornek'))).toEqual([])
  })

  it('denetim başarısızsa paket şifrelenmez ve hiçbir şey kaydedilmez', async () => {
    const repo = memoryRepo()
    await repo.putMembers([{ username: 'ayse', kek: 'A'.repeat(43) + '=', idKey: 'A'.repeat(43) + '=', active: true, createdAt: T0 }])
    await repo.patchMeta({ siteSalt: 'AAAAAAAAAAAAAAAAAAAAAA==' })
    // Takım adına ham bir oran değeri karışmış veri: paket bu değeri taşıyacağı için denetim yakalar.
    const poisoned = MATCHES.map((m, i) => (i === 0 ? { ...m, league: `Lig ${String(m.stats['Match FootyStats URL'])}` } : m))
    const encrypt = vi.spyOn(globalThis.crypto.subtle, 'encrypt')
    const error = await rejection(publish(repo, sources(poisoned), DAY, T1))
    expect(error).toBeInstanceOf(PublishError)
    expect((error as PublishError).kind).toBe('leak')
    expect((error as PublishError).problems.length).toBeGreaterThan(0)
    expect(encrypt).not.toHaveBeenCalled()
    expect(repo.state.meta.publishCounter).toBe(0)
    expect(repo.state.publications).toEqual([])
  })
})

describe('üye anahtar yedeği', () => {
  const PASS = 'mavi-kedi-73-yesil-masa'
  const snapshot: MemberSnapshot = {
    members: [
      { username: 'ayse', kek: 'A'.repeat(43) + '=', idKey: 'B'.repeat(43) + '=', active: true, createdAt: T0, renewedAt: T2 },
      { username: 'eski', kek: null, idKey: null, active: false, createdAt: T0, removedAt: T1 },
    ],
    siteSalt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    publishCounter: 7,
    texts: { disclaimer: 'Özel uyarı.', account: 'Özel not.' },
    publications: [{ n: 7, publishedAt: T2, day: DAY, memberCount: 1, bytes: 1234 }],
  }
  let file: KeyBackupFile

  beforeAll(async () => {
    file = await sealKeyBackup(snapshot, PASS, T3)
  }, SLOW)

  it('parola: en az 12 karakter, iki giriş aynı; zayıf parolada uyarı', () => {
    expect(checkPassphrase('kisa', 'kisa')).toMatchObject({ ok: false, error: 'Parola en az 12 karakter olmalı.' })
    expect(checkPassphrase('onikikarakter', 'onikikarakteR')).toMatchObject({ ok: false, error: 'İki parola aynı değil.' })
    expect(checkPassphrase(PASS, PASS)).toEqual({ ok: true, error: null, warnings: [] })
    expect(checkPassphrase('aaaaaaaaaaaa', 'aaaaaaaaaaaa').warnings.length).toBeGreaterThan(0)
    expect(checkPassphrase('123456789012', '123456789012').warnings.length).toBeGreaterThan(0)
    expect(checkPassphrase('gollazim2026!', 'gollazim2026!').warnings.join(' ')).toContain('kolay tahmin')
    expect(checkPassphrase('abcabcabcabc', 'abcabcabcabc').warnings.join(' ')).toContain('tekrar')
    // Zayıf parola uyarır ama engellemez; kısa parola engeller.
    expect(checkPassphrase('aaaaaaaaaaaa', 'aaaaaaaaaaaa').ok).toBe(true)
  })

  it('kısa parolayla yedek alınmaz', async () => {
    const error = await rejection(sealKeyBackup(snapshot, 'onbirkarakt', T3))
    expect(error).toBeInstanceOf(KeyBackupError)
    expect((error as KeyBackupError).kind).toBe('weak')
  })

  it('dosya: sürüm ve başlık açık, içerik şifreli; düz anahtar ve kullanıcı adı dosyada yok', () => {
    expect(Object.keys(file).sort()).toEqual(['ciphertext', 'createdAt', 'format', 'kdf', 'nonce', 'salt', 'v'])
    expect(file).toMatchObject({ format: KEY_BACKUP_FORMAT, v: 1, createdAt: T3, kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 } })
    const text = JSON.stringify(file)
    for (const secret of ['ayse', 'eski', 'A'.repeat(43), 'B'.repeat(43), 'Özel uyarı', PASS]) expect(text).not.toContain(secret)
    expect(parseKeyBackup(text)).toEqual(file)
  })

  it('gidiş-dönüş: aynı üyeler, anahtarlar, yayın sayacı, metinler ve geçmiş', async () => {
    expect(await openKeyBackup(JSON.stringify(file), PASS)).toEqual({ snapshot, createdAt: T3 })
  }, SLOW)

  it('yanlış parola net hatayla reddedilir', async () => {
    const error = await rejection(openKeyBackup(file, 'yanlis-parola-123'))
    expect(error).toBeInstanceOf(KeyBackupError)
    expect((error as KeyBackupError).kind).toBe('passphrase')
    expect((error as Error).message).toContain('Parola yanlış')
  }, SLOW)

  it('bozuk dosya net hatayla reddedilir', async () => {
    const flip = (base64: string): string => (base64[10] === 'A' ? base64.slice(0, 10) + 'B' + base64.slice(11) : base64.slice(0, 10) + 'A' + base64.slice(11))
    const notBackups: unknown[] = [
      'json değil',
      '{}',
      [],
      { ...file, ek: 1 },
      { ...file, format: 'gollazim-uye-paket' },
      { ...file, v: 2 },
      { ...file, salt: 'AAAA' },
      { ...file, ciphertext: 'bozuk!' },
      { ...file, kdf: { name: 'PBKDF2-SHA256', iterations: 1000 } },
      { ...file, kdf: { name: 'PBKDF2-SHA256', iterations: 2_000_001 } },
      JSON.stringify(assembleBackup({ uploads: [], matches: [], results: [], picks: [], thresholds: THRESHOLDS }, new Date(T0))),
    ]
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey')
    for (const value of notBackups) {
      const error = await rejection(openKeyBackup(value, PASS))
      expect(error, JSON.stringify(value)?.slice(0, 50)).toBeInstanceOf(KeyBackupError)
      expect((error as KeyBackupError).kind).toBe('format')
      expect((error as Error).message).toContain('üye anahtar yedeği değil ya da bozulmuş')
    }
    expect(deriveKey).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    // İçeriği ya da başlığı değiştirilmiş dosya doğru parolayla da açılmaz.
    for (const tampered of [{ ...file, ciphertext: flip(file.ciphertext) }, { ...file, createdAt: T0 }, { ...file, nonce: flip(file.nonce) }, { ...file, kdf: { name: 'PBKDF2-SHA256', iterations: 600_001 } }])
      expect(((await rejection(openKeyBackup(tampered, PASS))) as KeyBackupError).kind).toBe('passphrase')
  }, SLOW)

  it('geçersiz içerikli yedek yüklenmez: aktif üyenin anahtarı eksikse ya da ad yineleniyorsa', async () => {
    const bad: MemberSnapshot[] = [
      { ...snapshot, members: [{ username: 'ayse', kek: null, idKey: null, active: true, createdAt: T0 }] },
      { ...snapshot, members: [snapshot.members[0], snapshot.members[0]] },
      { ...snapshot, members: [{ ...snapshot.members[0], username: 'Ayşe' }] },
      { ...snapshot, siteSalt: null },
      { ...snapshot, publishCounter: -1 },
    ]
    const deriveKey = vi.spyOn(globalThis.crypto.subtle, 'deriveKey')
    for (const value of bad) expect(await rejection(sealKeyBackup(value, PASS, T3))).toBeInstanceOf(KeyBackupError)
    expect(deriveKey).not.toHaveBeenCalled()
  })

  it('yedekle ve yükle: aynı aktif üyeler ve aynı yayın numarası devam eder; üyeler yeni yayını açar', async () => {
    const repo = memoryRepo()
    const issued = await addMembers(repo, ['ayse', 'mehmet', 'zeynep'], T0)
    await publish(repo, sources(), DAY, T1)
    await removeMemberByName(repo, 'zeynep', T1)
    await publish(repo, sources(), DAY, T2)
    const { file: backup, fileName } = await backupMemberKeys(repo, PASS, T2, '2026-10-05')
    expect(fileName).toBe('gollazim-uye-anahtar-2026-10-05.json')
    expect(repo.state.meta.lastKeyBackupAt).toBe(T2)

    // "Profil sıfırlandı": boş bir depoya yüklenir.
    const fresh = memoryRepo()
    const wrong = await rejection(restoreMemberKeys(fresh, JSON.stringify(backup), 'yanlis-parola-123', T3))
    expect((wrong as KeyBackupError).kind).toBe('passphrase')
    expect(fresh.state.members.size).toBe(0) // hata olunca hiçbir şey değişmez

    const restored = await restoreMemberKeys(fresh, JSON.stringify(backup), PASS, T3)
    expect(restored.members.filter((m) => m.active).map((m) => m.username)).toEqual(['ayse', 'mehmet'])
    expect([...fresh.state.members.values()]).toEqual([...repo.state.members.values()])
    expect(fresh.state.meta).toMatchObject({ siteSalt: repo.state.meta.siteSalt, publishCounter: 2 })
    expect(fresh.state.publications.map((p) => p.n).sort()).toEqual([1, 2])
    expect(keyBackupStatus([...fresh.state.members.values()], fresh.state.meta).level).toBe('ok')

    const next = await publish(fresh, sources(), DAY, T3)
    expect(next.record).toMatchObject({ n: 3, memberCount: 2 })
    for (const { username, password } of issued.slice(0, 2)) expect((await openEnvelope(next.text, username, password)).payload.n).toBe(3)
    expect(await rejection(openEnvelope(next.text, 'zeynep', issued[2].password))).toBeInstanceOf(MemberAccessError)
  }, SLOW)
})

describe('üye anahtar yedeği hatırlatıcısı', () => {
  const member: MemberRecord = { username: 'ayse', kek: 'x', idKey: 'y', active: true, createdAt: T0 }

  it('üye yokken hatırlatma yok; üye varken hiç yedek alınmadıysa uyarı', () => {
    expect(keyBackupStatus([], { keysChangedAt: null, lastKeyBackupAt: null }).level).toBe('none')
    expect(keyBackupStatus([member], { keysChangedAt: T0, lastKeyBackupAt: null })).toEqual({ level: 'never', text: 'Üye anahtar yedeği hiç alınmadı.' })
  })

  it('üye eklenince, çıkarılınca ya da şifre yenilenince "yedeğin eskidi"; yedek alınınca güncel', async () => {
    const repo = memoryRepo()
    const status = async () => keyBackupStatus(await repo.listMembers(), repo.state.meta).level
    await repo.putMembers([member])
    await repo.patchMeta({ siteSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', keysChangedAt: T0 })
    repo.state.members.set('ayse', { ...member, kek: 'A'.repeat(43) + '=', idKey: 'B'.repeat(43) + '=' })
    expect(await status()).toBe('never')
    await backupMemberKeys(repo, 'mavi-kedi-73-yesil-masa', T1, '2026-10-05')
    expect(await status()).toBe('ok')
    await removeMemberByName(repo, 'ayse', T2)
    expect(await status()).toBe('stale')
    expect(keyBackupStatus([member], { keysChangedAt: T2, lastKeyBackupAt: T1 }).text).toContain('yedeğin eskidi')
    await backupMemberKeys(repo, 'mavi-kedi-73-yesil-masa', T3, '2026-10-05')
    expect(await status()).toBe('ok')
  }, SLOW)

  it('yayın yapmak ya da metin değiştirmek yedeği eskitmez', async () => {
    const repo = memoryRepo()
    await repo.patchMeta({ keysChangedAt: T0, lastKeyBackupAt: T1 })
    await saveMemberTexts(repo, { disclaimer: 'Yeni.', account: 'Yeni.' })
    await repo.patchMeta({ publishCounter: 5 })
    expect(keyBackupStatus([member], repo.state.meta).level).toBe('ok')
  })
})

describe('normal yedek üye kayıtlarından bağımsızdır', () => {
  it('normal yedek dosyasında üye tablosu, anahtar ya da yayın geçmişi alanı yoktur', () => {
    const backup = assembleBackup({ uploads: [], matches: [], results: [], picks: [], thresholds: THRESHOLDS }, new Date(T0))
    expect(Object.keys(backup).sort()).toEqual(['aiPrompts', 'aiVerdicts', 'app', 'exportedAt', 'leagueTables', 'marketConflictLimit', 'matches', 'picks', 'results', 'sharedPicks', 'storySelections', 'storyTexts', 'teamAliases', 'thresholds', 'uploads', 'version'])
    expect(backup.version).toBe(1)
    expect(JSON.stringify(Object.keys(backup))).not.toMatch(/member|uye|publication|kek|idKey/i)
  })

  it('normal yedeğin dışa ve içe aktarımı üye tablolarına hiç dokunmaz (kaynak denetimi)', () => {
    // Gerçek IndexedDB ile aynı denetim uçtan uca denemede yapılır (scripts/uye-admin-e2e.mjs).
    const backupRepo = readFileSync('src/services/data/dexie/backupRepo.ts', 'utf8')
    expect(backupRepo).not.toMatch(/db\.(members|memberMeta|publications)|memberAdmin/)
    for (const file of ['uploadsRepo', 'matchesRepo', 'settingsRepo']) expect(readFileSync(`src/services/data/dexie/${file}.ts`, 'utf8')).not.toMatch(/db\.(members|memberMeta|publications)/)
    const db = readFileSync('src/services/data/dexie/db.ts', 'utf8')
    expect(db).toContain("db.version(7).stores({\n  members: 'username',\n  memberMeta: 'key',\n  publications: 'n',\n})")
  })
})

describe('toplu ekleme (50 kullanıcı)', () => {
  it('50 üye sırayla türetilir, ilerleme bildirilir; hepsi aynı paketi açar', async () => {
    const repo = memoryRepo()
    const names = Array.from({ length: 50 }, (_, i) => `uye${String(i + 1).padStart(2, '0')}`)
    const progress: [number, number][] = []
    const started = performance.now()
    const issued = await addMembers(repo, names, T0, (done, total) => progress.push([done, total]))
    const seconds = (performance.now() - started) / 1000

    expect(progress).toEqual(names.map((_, i) => [i + 1, 50]))
    expect(issued.map((i) => i.username)).toEqual(names)
    expect(new Set(issued.map((i) => i.password)).size).toBe(50)
    expect(repo.state.members.size).toBe(50)
    expect(distributionCsv(issued).trim().split('\r\n')).toHaveLength(51)
    expect(seconds).toBeLessThan(200)

    const publication = await publish(repo, sources(), DAY, T1)
    expect(publication.record.memberCount).toBe(50)
    expect(publication.envelope.slots).toHaveLength(64)
    for (const name of names) expect((await openWithKeys(publication.text, keysOf(repo, name))).n).toBe(1)
    // Üretilen şifreler gerçekten bu anahtarları veriyor (üçü baştan türetilerek denenir).
    for (const index of [0, 24, 49]) expect((await openEnvelope(publication.text, issued[index].username, issued[index].password)).payload.n).toBe(1)
    expect(await rejection(openEnvelope(publication.text, 'uye01', generatePassword()))).toBeInstanceOf(MemberAccessError)
  }, SLOW)
})

// Admin arayüzünden indirilen GERÇEK paketin denetimi; normal test çalıştırmasında atlanır.
// scripts/uye-admin-e2e.mjs paketi ve bir test üyesinin giriş bilgisini yazdıktan sonra:
//   UYE_E2E_PAKET=…/paket.json UYE_E2E_GIRIS=…/giris.json UYE_BACKUP=…yedek.json npx vitest run src/services/memberAdmin
describe.runIf(process.env.UYE_E2E_PAKET && process.env.UYE_E2E_GIRIS && process.env.UYE_BACKUP)('indirilen paket: düz hâlinde yasak terim ve ham alan yok', () => {
  it('paket açılır; ham veriye karşı sızıntı denetimi ve terim taraması temizdir', async () => {
    const login = JSON.parse(readFileSync(process.env.UYE_E2E_GIRIS!, 'utf8')) as IssuedLogin
    const backup = JSON.parse(readFileSync(process.env.UYE_BACKUP!, 'utf8')) as { matches: Match[]; aiVerdicts?: { reason: string; risk: string }[] }
    const { payload } = await openEnvelope(readFileSync(process.env.UYE_E2E_PAKET!, 'utf8'), login.username, login.password)
    const dates = payload.days.map((d) => d.date)
    const scan = scanForLeaks(payload, backup.matches.filter((m) => dates.includes(m.date)))
    expect(scan.problems).toEqual([])
    expect(scan.checked).toBeGreaterThan(1000)
    // Uyarı metinleri dışındaki içerikte yasak terimler
    const data = JSON.stringify({ ...payload, texts: null }).toLocaleLowerCase('tr')
    for (const term of ['footystats', 'http', 'www.', 'odds', 'xg', 'csv', 'piyasa', 'kaynak', 'ortalama', '"stats"', 'threshold', 'reason', 'risk', 'decision', 'provider', 'marketpercent', 'scoresnapshot']) expect(data, term).not.toContain(term)
    for (const verdict of backup.aiVerdicts ?? []) for (const s of [verdict.reason, verdict.risk]) if (s.length >= 12) expect(data).not.toContain(s.toLocaleLowerCase('tr'))
    expect(payload.days.flatMap((d) => d.lists.flatMap((l) => l.items)).length).toBeGreaterThan(50)
  }, SLOW)
})
