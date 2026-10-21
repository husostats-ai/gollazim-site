import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { behindMain, behindMainText, compareUrl, fetchBehindMain, isDeployedAdmin } from './adminBehind'

const response = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body })

describe('admin: main\'in kaç commit gerisinde', () => {
  it('karşılaştırma yanıtından main\'in önde olduğu commit sayısı okunur', () => {
    expect(behindMain({ status: 'ahead', ahead_by: 3, behind_by: 0 })).toBe(3)
    expect(behindMain({ status: 'identical', ahead_by: 0, behind_by: 0 })).toBe(0)
    expect(behindMain({ status: 'diverged', ahead_by: 2, behind_by: 1 })).toBe(2)
    for (const bad of [null, 'x', {}, { status: 'ahead' }, { status: 'ahead', ahead_by: -1 }, { status: 'ahead', ahead_by: 1.5 }, { status: 'bilinmez', ahead_by: 1 }]) expect(behindMain(bad), JSON.stringify(bad)).toBeNull()
  })

  it('tek istek: halka açık API, kimlik bilgisi yok; adres bu derlemenin commit\'iyle main\'i karşılaştırır', async () => {
    const calls: { url: string; init: unknown }[] = []
    const n = await fetchBehindMain('abc1234', async (url, init) => (calls.push({ url, init }), { ok: true, json: async () => ({ status: 'ahead', ahead_by: 4 }) }))
    expect(n).toBe(4)
    expect(calls).toEqual([{ url: 'https://api.github.com/repos/husostats-ai/gollazim-site/compare/abc1234...main?per_page=1', init: { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } } }])
    expect(compareUrl('abc1234')).toBe(calls[0].url)
  })

  it('istek ya da yanıt başarısızsa sessizce null; commit bilinmiyorsa istek atılmaz', async () => {
    expect(await fetchBehindMain('abc1234', response(false, { status: 'ahead', ahead_by: 1 }))).toBeNull()
    expect(await fetchBehindMain('abc1234', response(true, { message: 'API rate limit exceeded' }))).toBeNull()
    expect(await fetchBehindMain('abc1234', async () => Promise.reject(new TypeError('ağ yok')))).toBeNull()
    expect(await fetchBehindMain('abc1234', async () => ({ ok: true, json: async () => Promise.reject(new SyntaxError('json')) }))).toBeNull()
    let called = false
    expect(await fetchBehindMain('bilinmiyor', async () => ((called = true), { ok: true, json: async () => ({}) }))).toBeNull()
    expect(called).toBe(false)
  })

  it('istek yalnızca yayındaki admin adresinden atılır; yerel geliştirme ve denemeler dış istek atmaz', () => {
    expect(isDeployedAdmin('husostats-ai.github.io')).toBe(true)
    for (const host of ['localhost', '127.0.0.1', 'github.io.example.com']) expect(isDeployedAdmin(host), host).toBe(false)
    expect(readFileSync('src/components/AdminBehindMain.tsx', 'utf8')).toContain('if (!isDeployedAdmin(window.location.hostname)) return')
  })

  it('uyarı metni ve bileşen: yalnızca geride olunca, hata hiç gösterilmez; üye tarafı bu modüle ulaşmaz', () => {
    expect(behindMainText('abc1234', 2)).toBe("Bu admin sürümü (abc1234) main'in 2 commit gerisinde: üretilen paketlere bu commit'ler yansımaz. Güncellemek için admin'i yeniden yayınla (gh workflow run deploy.yml --ref main).")
    const component = readFileSync('src/components/AdminBehindMain.tsx', 'utf8')
    expect(component).toContain('if (behind === null || behind === 0) return null')
    expect(readFileSync('src/pages/AdminPage.tsx', 'utf8')).toContain('<AdminBehindMain />')
    // Üye sitesi kodunda GitHub API'si adı geçmez (içe aktarma sınırı ayrıca boundary.test.ts'te).
    const memberSources = ['src/member/MemberApp.tsx', 'src/member/main.tsx', 'src/services/member/controller.ts', 'src/services/member/source.ts']
    for (const file of memberSources) expect(readFileSync(file, 'utf8'), file).not.toMatch(/api\.github\.com|adminBehind/)
  })

  it('deploy.yml başka daldan yayını açık mesajla durdurur', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(workflow).toContain("if: github.ref != 'refs/heads/main'")
    expect(workflow).toContain('Admin yalnızca main dalından yayınlanır')
    expect(workflow.indexOf('Yalnızca main dalından yayın')).toBeLessThan(workflow.indexOf('actions/checkout'))
  })
})
