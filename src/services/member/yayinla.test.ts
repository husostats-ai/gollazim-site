import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { assembleBackup } from '../data/backupFormat'
import { sealKeyBackup } from '../memberAdmin/keyBackup'
import { memberInput, THRESHOLDS } from './__fixtures__/rawData'
import { newSiteSalt, parseEnvelope, randomBytes, sealPayload, toBase64, type MemberEnvelope } from './crypto'
import { buildMemberPayload } from './payload'

// Yayın komutunun (scripts/yayinla.mjs) dosya denetimi: yalnızca ŞİFRELİ yayın paketi geçer.

interface Check {
  ok: boolean
  problems?: string[]
  n?: number
  slots?: number
  bytes?: number
}
let checkPackageText: (text: string) => Check
let envelope: MemberEnvelope
const payload = buildMemberPayload(memberInput())

beforeAll(async () => {
  // Betik düz JavaScript'tir (derleme adımı olmadan çalışır); yolu çalışma anında verilir.
  const path = resolve('scripts/lib/paket-denetim.mjs')
  checkPackageText = ((await import(/* @vite-ignore */ path)) as { checkPackageText: typeof checkPackageText }).checkPackageText
  envelope = await sealPayload({ payload, members: [{ kek: randomBytes(32), idKey: randomBytes(32) }], siteSalt: newSiteSalt() })
})

const problemsOf = (value: unknown): string => {
  const result = checkPackageText(typeof value === 'string' ? value : JSON.stringify(value))
  expect(result.ok).toBe(false)
  return result.problems!.join(' | ')
}

describe('yayın komutu: dosya denetimi', () => {
  it('şifreli yayın paketi kabul edilir', () => {
    const text = JSON.stringify(envelope)
    expect(checkPackageText(text)).toEqual({ ok: true, n: payload.n, publishedAt: payload.publishedAt, slots: 64, bytes: text.length })
    // Uygulamanın kendi denetimiyle aynı dosyayı kabul ediyor.
    expect(parseEnvelope(text)).toEqual(envelope)
  })

  it('DÜZ (şifresiz) paket reddedilir', () => {
    expect(problemsOf(payload)).toMatch(/DÜZ \(şifresiz\) bir paket/)
    expect(problemsOf(payload)).toMatch(/okunabilir \(şifresiz\) alanlar/)
  })

  it('normal veri yedeği ve üye anahtar yedeği reddedilir', async () => {
    const backup = assembleBackup({ uploads: [], matches: memberInput().days[0].matches, results: [], picks: [], thresholds: THRESHOLDS }, new Date('2026-10-05T06:00:00.000Z'))
    expect(problemsOf(backup)).toMatch(/normal veri yedeği \(HAM VERİ içerir\)/)
    const keyBackup = await sealKeyBackup({ members: [], siteSalt: null, publishCounter: 0, texts: payload.texts, publications: [] }, 'mavi-kedi-73-yesil-masa', '2026-10-05T06:00:00.000Z')
    expect(problemsOf(keyBackup)).toMatch(/üye anahtar yedeği/)
  })

  it('gövdesi şifresiz olan sahte paket reddedilir (başlık doğru olsa da)', () => {
    const plainBody = toBase64(new TextEncoder().encode(JSON.stringify(payload)))
    expect(problemsOf({ ...envelope, ciphertext: plainBody })).toMatch(/gövde şifreli görünmüyor/)
    // Gövdeye düz paket eklenmiş gerçek paket
    expect(problemsOf({ ...envelope, ek: payload })).toMatch(/okunabilir \(şifresiz\) alanlar|beklenmeyen alan/)
  })

  it('başlığı eksik, bozuk ya da sınır dışı paket reddedilir', () => {
    const { ciphertext: _, ...noBody } = envelope
    expect(problemsOf(noBody)).toMatch(/eksik alan: ciphertext/)
    expect(problemsOf({ ...envelope, v: 2 })).toMatch(/sürümü/)
    expect(problemsOf({ ...envelope, n: 0 })).toMatch(/yayın numarası/)
    expect(problemsOf({ ...envelope, kdf: { name: 'PBKDF2-SHA256', iterations: 1000 } })).toMatch(/iterasyonu/)
    expect(problemsOf({ ...envelope, kdf: { name: 'PBKDF2-SHA256', iterations: 3_000_000 } })).toMatch(/iterasyonu/)
    expect(problemsOf({ ...envelope, slots: [] })).toMatch(/sarmal listesi/)
    expect(problemsOf({ ...envelope, slots: ['AAAA'] })).toMatch(/sarmal listesi/)
    expect(problemsOf({ ...envelope, nonce: 'AAAA' })).toMatch(/nonce/)
    expect(problemsOf('bu bir paket değil')).toMatch(/JSON değil/)
    expect(problemsOf('[]')).toMatch(/nesne değil|küçük/)
  })

  it('boyut sınırı: çok büyük dosya reddedilir', () => {
    expect(problemsOf({ ...envelope, ciphertext: toBase64(randomBytes(65_536)).repeat(48) })).toMatch(/çok büyük/)
  })

  it('yayın numarasının öncekinden büyük olması şart değildir (yedekten dönünce geri gidebilir)', () => {
    expect(checkPackageText(JSON.stringify({ ...envelope, n: 1 })).ok).toBe(true)
  })
})
