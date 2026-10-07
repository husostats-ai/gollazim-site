import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MEMBER_SITE_VERSION_URL } from '../../config/member'
import { MEMBER_PAYLOAD_VERSION } from '../member/payload'
import { fetchSiteVersion, parseSiteVersion, siteVersionStatus } from './siteVersion'

const admin = { commit: 'abc1234', payloadVersion: 2 }

describe('üye sitesi sürüm karşılaştırması', () => {
  it('aynı commit: güncel', () => {
    expect(siteVersionStatus({ commit: 'abc1234', payloadVersion: 2 }, admin)).toEqual({ level: 'ok', text: 'Üye sitesi güncel (abc1234).' })
  })

  it('farklı commit: "eski sürümde olabilir" (paketi yine de açabilir)', () => {
    const status = siteVersionStatus({ commit: '0000000', payloadVersion: 2 }, admin)
    expect(status.level).toBe('older')
    expect(status.text).toBe('Üye sitesi eski sürümde olabilir (üye sitesi: 0000000, bu sürüm: abc1234).')
  })

  it('paket sürümü geride: üye sitesi paketi açamaz (commit aynı olsa bile)', () => {
    for (const commit of ['0000000', 'abc1234']) {
      const status = siteVersionStatus({ commit, payloadVersion: 1 }, admin)
      expect(status.level).toBe('incompatible')
      expect(status.text).toContain('AÇAMAZ')
    }
    // Üye sitesi daha yeni paket sürümünü de açabiliyorsa sorun yok.
    expect(siteVersionStatus({ commit: '0000000', payloadVersion: 3 }, admin).level).toBe('older')
  })

  it('okunamayan sürüm: bilinmiyor', () => {
    expect(siteVersionStatus(null, admin).level).toBe('unknown')
  })

  it('sürüm bilgisi katı doğrulanır', () => {
    expect(parseSiteVersion({ commit: 'abc1234', payloadVersion: 2 })).toEqual({ commit: 'abc1234', payloadVersion: 2 })
    expect(parseSiteVersion({ commit: 'bilinmiyor', payloadVersion: 2 })).toEqual({ commit: 'bilinmiyor', payloadVersion: 2 })
    for (const bad of [null, 'x', {}, { commit: 'abc', payloadVersion: 2 }, { commit: 'abc1234' }, { commit: 'abc1234', payloadVersion: 0 }, { commit: 'abc1234', payloadVersion: '2' }, { commit: '<script>', payloadVersion: 2 }]) expect(parseSiteVersion(bad)).toBeNull()
  })

  it('yalnızca aynı alan adındaki sürüm adresi istenir; hata olursa null', async () => {
    const calls: string[] = []
    const ok = await fetchSiteVersion(MEMBER_SITE_VERSION_URL, async (url) => (calls.push(url), { ok: true, json: async () => ({ commit: 'abc1234', payloadVersion: 2 }) }), 1700000000000)
    expect(ok).toEqual({ commit: 'abc1234', payloadVersion: 2 })
    expect(calls).toEqual(['/gollazim-uye/surum.json?t=1700000000000'])
    expect(MEMBER_SITE_VERSION_URL.startsWith('/')).toBe(true) // alan adı içermez: aynı alan adına gider
    expect(await fetchSiteVersion(MEMBER_SITE_VERSION_URL, async () => ({ ok: false, json: async () => ({}) }), 1)).toBeNull()
    expect(await fetchSiteVersion(MEMBER_SITE_VERSION_URL, async () => Promise.reject(new Error('ağ')), 1)).toBeNull()
    expect(await fetchSiteVersion(MEMBER_SITE_VERSION_URL, async () => ({ ok: true, json: async () => ({ commit: 'bozuk' }) }), 1)).toBeNull()
  })

  it('üye sitesinin bildirdiği paket sürümü, üye uygulamasının gerçekten açabildiği sürümle aynıdır', () => {
    const config = readFileSync('vite.uye.config.ts', 'utf8')
    expect(Number(/MEMBER_SITE_PAYLOAD_VERSION = (\d+)/.exec(config)![1])).toBe(MEMBER_PAYLOAD_VERSION)
  })
})
