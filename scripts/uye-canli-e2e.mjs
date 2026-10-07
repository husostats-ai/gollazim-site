// Geliştirme aracı: CANLI yayın adresindeki paketi, yereldeki üye sayfasıyla (geliştirme
// sunucusu) gerçek tarayıcıda dener ve yayın gecikmesini ölçer.
//
//   UYE_BACKUP=samples/gollazim-yedek-….json node scripts/uye-canli-e2e.mjs
//
// DİKKAT: yayın adresine DENEME paketi gönderir ve sonunda yayındaki paketi KALDIRIR.
// Gerçek üyeler yayındayken çalıştırmayın. Sentetik test kullanıcısı ve iki paket geçici
// bir klasörde üretilir, deneme bitince silinir; kalıcı bir giriş dosyası bırakılmaz.
// Tarayıcı geçici bir profille açılır. Çıktı (kimlik içermez): UYE_ORNEK/canli-e2e-rapor.json
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (!process.env.UYE_BACKUP || !existsSync(resolve(process.env.UYE_BACKUP))) {
  console.error('UYE_BACKUP (JSON yedek) verilmeli.')
  process.exit(1)
}
const reportDir = resolve(process.env.UYE_ORNEK ?? 'samples/uye')
const sampleDir = mkdtempSync(join(tmpdir(), 'gollazim-canli-ornek-'))

/** Geçici klasörde şifreli örnek paket (ve ilk çağrıda sentetik test kullanıcısı) üretir */
function generate(dir, env = {}) {
  execFileSync('npx', ['vitest', 'run', 'src/services/member/sample'], { env: { ...process.env, UYE_ORNEK: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
}
generate(sampleDir, { UYE_N: '1' })
generate(sampleDir, { UYE_N: '2', UYE_DOSYA: 'paket-2.json' })
const yayinla = (...args) => new Promise((done) => execFile('node', ['scripts/yayinla.mjs', ...args], { encoding: 'utf8' }, (error, stdout, stderr) => done({ ok: !error, text: `${stdout}${stderr}` })))
const packageUrl = process.env.YAYIN_URL ?? 'https://husostats-ai.github.io/gollazim-yayin/paket.json'
const login = JSON.parse(readFileSync(join(sampleDir, 'giris.json'), 'utf8'))
// Üye sayfası paketi bu adresten ister (derleme zamanı ayarı; sunucu açılmadan önce verilir).
process.env.VITE_UYE_PAKET_URL = packageUrl
const { createServer } = await import('vite')
const puppeteer = createRequire(join(resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107')), 'x.js'))('puppeteer-core')

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const local = `http://127.0.0.1:${server.httpServer.address().port}`
const profile = mkdtempSync(join(tmpdir(), 'gollazim-canli-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })

const report = { adres: packageUrl, adimlar: [], olcumler: {} }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail && { ayrinti: String(detail) }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sel = (id) => `[data-testid="${id}"]`
const text = (page, id) => page.$eval(sel(id), (el) => el.textContent.trim())
const numberAt = async (url) => {
  const response = await fetch(url, { cache: 'no-store' })
  return response.ok ? { n: JSON.parse(await response.text()).n, age: response.headers.get('age'), cache: response.headers.get('x-cache') } : { n: null, status: response.status }
}

let failed = false
try {
  const firstPublish = await yayinla(join(sampleDir, 'paket.json'))
  step('ilk deneme paketi yayınlandı', firstPublish.ok, firstPublish.text.trim().split('\n').pop())
  if (!firstPublish.ok) throw new Error('ilk yayın yapılamadı')
  const page = await browser.newPage()
  const external = []
  page.on('request', (r) => !r.url().startsWith(local) && !r.url().startsWith('data:') && external.push(r.url()))
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${local}/#/uye`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-username'))
  // Yasal uyarı penceresi: giriş formu ancak kabulden sonra kullanılabilir.
  if (await page.$(sel('member-legal'))) await page.$eval(sel('member-legal-accept'), (el) => el.click())
  await page.type(sel('member-username'), login.username)
  await page.type(sel('member-password'), login.password)
  const started = Date.now()
  await page.keyboard.press('Enter')
  await page.waitForSelector(`${sel('member-cards')}, ${sel('member-error')}`, { timeout: 40000 })
  const signedIn = (await page.$(sel('member-cards'))) !== null
  step('canlı adresteki paketle giriş', signedIn, signedIn ? `${Date.now() - started} ms · ${await text(page, 'member-publish-no')} · ${await text(page, 'member-updated')}` : await text(page, 'member-error'))
  if (!signedIn) throw new Error('giriş yapılamadı')
  const first = Number((await text(page, 'member-publish-no')).replace(/\D/g, ''))
  step('kartlar çizildi', (await page.$$eval(sel('member-card'), (els) => els.length)) > 0)

  // Önbellek ölçümü için damgasız adres bir kez istenir (tarayıcı/CDN önbelleğine girer).
  const plainBefore = await numberAt(packageUrl)
  // Aynı ölçüm tarayıcının kendi önbelleğiyle: sayfa içinden damgasız istek
  const browserNumber = (url) => page.evaluate((u) => fetch(u).then((r) => r.json()).then((j) => j.n, () => null), url)
  const browserBefore = await browserNumber(packageUrl)

  // Yeni yayın: yayın komutu çalışırken üye sayfası açık kalır.
  const publishStarted = Date.now()
  const publishOutput = await yayinla(join(sampleDir, 'paket-2.json'))
  const visibleSeconds = /\((\d+) sn sonra görüldü\)/.exec(publishOutput.text)?.[1]
  step('yeni yayın gönderildi ve adresten doğrulandı', publishOutput.ok, publishOutput.text.trim().split('\n').pop())
  report.olcumler.yayinKomutuToplamSn = ((Date.now() - publishStarted) / 1000).toFixed(0)
  report.olcumler.pagesGorunmeSn = visibleSeconds ?? null

  // Zaman damgalı istek yeni paketi görürken damgasız (önbellekli) istek ne veriyor?
  const stamped = await numberAt(`${packageUrl}?t=${Date.now()}`)
  const plainAfter = await numberAt(packageUrl)
  report.olcumler.damgali = stamped
  report.olcumler.damgasiz = { once: plainBefore, sonra: plainAfter }
  const browserAfter = await browserNumber(packageUrl)
  const browserStamped = await browserNumber(`${packageUrl}?t=${Date.now()}`)
  report.olcumler.tarayici = { damgasizOnce: browserBefore, damgasizSonra: browserAfter, damgali: browserStamped }
  console.log(`  tarayıcıda damgasız istek: yayın no ${browserAfter}${browserAfter === first ? ' → ESKİ paket (tarayıcı önbelleği, 10 dk)' : ''}; damgalı istek: yayın no ${browserStamped}`)
  step('zaman damgalı istek yeni yayını veriyor', stamped.n === first + 1, `yayın no ${stamped.n}`)
  console.log(`  damgasız adres aynı anda: yayın no ${plainAfter.n} (age ${plainAfter.age}, ${plainAfter.cache})${plainAfter.n === first ? ' → ESKİ paket: damga önbelleği atlıyor' : ' → yeni paket'}`)

  // Açık oturum yeni yayını şifre sormadan alır.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForFunction((s, n) => document.querySelector(s)?.textContent.trim() === `Yayın no ${n}`, { timeout: 30000 }, sel('member-publish-no'), first + 1)
  step('açık oturum yeni yayını şifre sormadan aldı', true, await text(page, 'member-publish-no'))

  const hosts = [...new Set(external.map((u) => new URL(u).origin + new URL(u).pathname))]
  // Damgasız istekler bu denemenin önbellek ölçümleridir (2 adet); üye sayfasının kendi istekleri hep damgalıdır.
  const unstamped = external.filter((u) => !/\?t=\d{13}$/.test(u)).length
  step('dış istekler yalnızca yayın adresine; üye sayfasının istekleri zaman damgalı', hosts.length === 1 && hosts[0] === packageUrl && unstamped === 2, `${external.length} istek (${unstamped} ölçüm) → ${hosts.join(', ')}`)
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))
  step('oturum deposunda şifre yok', !stored.includes(login.password) && !stored.includes(login.password.replace(/-/g, '')))
} catch (error) {
  failed = true
  step('beklenmeyen hata', false, String(error?.message ?? error))
} finally {
  await browser.close()
  await server.close()
  rmSync(profile, { recursive: true, force: true })
  // Deneme paketi canlıda kalmaz; test kullanıcısının şifresi de burada biter.
  const removed = await yayinla('--kaldir')
  step('deneme paketi yayından kaldırıldı', removed.ok, removed.text.trim().split('\n').pop())
  rmSync(sampleDir, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(reportDir, 'canli-e2e-rapor.json'), JSON.stringify(report, null, 1) + '\n')
console.log(`\n${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · ölçümler: ${JSON.stringify(report.olcumler)}`)
process.exit(failed ? 1 : 0)
