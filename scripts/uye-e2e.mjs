// Geliştirme aracı: üye sayfasını DERLENMİŞ hâliyle, gerçek tarayıcıda uçtan uca dener.
//
//   npm run build
//   UYE_ORNEK=samples/uye UYE_BACKUP=samples/gollazim-yedek-….json npm run uye:ornek   (paketler)
//   npm run uye:e2e
//
// Yayındaki düzeni taklit eden küçük bir yerel sunucu açar: site /gollazim-site/ altında,
// şifreli paket aynı alan adında /gollazim-yayin/paket.json adresinde. Tarayıcı her
// çalıştırmada yeni, geçici bir profille açılır; kullanıcının tarayıcı verisine dokunulmaz.
// Girdi: dist/ ve UYE_ORNEK klasörü (paket.json, paket-2.json, paket-cikarilmis.json,
// paket-eski.json, giris.json). Çıktı: UYE_ORNEK/ekran/*.png ve UYE_ORNEK/e2e-rapor.json
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const sampleDir = resolve(process.env.UYE_ORNEK ?? 'samples/uye')
const dist = resolve('dist')
const puppeteerDir = resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107'))
const puppeteer = createRequire(join(puppeteerDir, 'x.js'))('puppeteer-core')
const login = JSON.parse(readFileSync(join(sampleDir, 'giris.json'), 'utf8'))
const shots = join(sampleDir, 'ekran')
mkdirSync(shots, { recursive: true })

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json' }
/** Sunucunun paket adresinde verdiği dosya; null ise 404 */
let packageFile = 'paket.json'
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  let file = null
  if (path === '/gollazim-yayin/paket.json') file = packageFile && join(sampleDir, packageFile)
  else if (path.startsWith('/gollazim-site/')) file = normalize(join(dist, path.slice('/gollazim-site/'.length) || 'index.html'))
  if (!file || !file.startsWith(path.startsWith('/gollazim-yayin/') ? sampleDir : dist) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('Not Found')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const site = `${origin}/gollazim-site/`

const profile = mkdtempSync(join(tmpdir(), 'gollazim-uye-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })

const report = { tarayici: await browser.version(), adimlar: [], istekler: [], ekranlar: [] }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail && { ayrinti: detail }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const FORBIDDEN = /oran|piyasa|xg|csv|kaynak|footystats|bağlantı|https?:|www\.|odds|ortalama/

const requests = []
const watch = (page) => page.on('request', (r) => requests.push(r.url()))
const sel = (id) => `[data-testid="${id}"]`
const text = (page, id) => page.$eval(sel(id), (el) => el.textContent.trim())
const visibleText = (page) =>
  page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[title],[aria-label],[alt],[placeholder]')].flatMap((el) => ['title', 'aria-label', 'alt', 'placeholder'].map((a) => el.getAttribute(a) ?? ''))].join(' ').toLocaleLowerCase('tr'))
const overflow = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
const session = (page) => page.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage }, cookie: document.cookie }))
async function shot(page, name, width) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2 })
  await new Promise((r) => setTimeout(r, 150))
  const size = await overflow(page)
  await page.screenshot({ path: join(shots, `${name}-${width}.png`), fullPage: true })
  report.ekranlar.push({ dosya: `${name}-${width}.png`, genislik: width, tasma: size.scroll > size.inner ? `${size.scroll} > ${size.inner}` : 'yok' })
  return size.scroll <= size.inner
}
async function signIn(page, username, password) {
  await page.waitForSelector(sel('member-username'))
  await page.$eval(sel('member-username'), (el) => (el.value = ''))
  await page.type(sel('member-username'), username)
  await page.type(sel('member-password'), password)
  await page.keyboard.press('Enter')
}
const refreshNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

let failed = false
try {
  const page = await browser.newPage()
  watch(page)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.goto(`${site}#/uye`, { waitUntil: 'networkidle0' })

  // 1) Giriş ekranı
  await page.waitForSelector(sel('member-login'))
  const robots = await page.$eval('meta[name="robots"]', (el) => el.content)
  step('giriş ekranı açıldı; noindex etiketi var', robots.includes('noindex'), robots)
  const links = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')))
  step('giriş ekranında gezinme bağlantısı yok', links.length === 0, JSON.stringify(links))
  const attrs = await page.$eval(sel('member-password'), (el) => [el.type, el.autocomplete, el.getAttribute('autocapitalize'), el.getAttribute('autocorrect'), el.spellcheck].join(','))
  step('şifre alanı öznitelikleri', attrs === 'password,current-password,none,off,false', attrs)
  await page.click(sel('member-password-toggle'))
  step('şifre gösterme düğmesi', (await page.$eval(sel('member-password'), (el) => el.type)) === 'text')
  await page.click(sel('member-password-toggle'))
  const scriptsBefore = [...new Set(requests.filter((u) => u.endsWith('.js')).map((u) => u.split('/').pop().replace(/-[A-Za-z0-9_-]{8}\.js$/, '.js')))].sort()
  step('üye sayfasında uygulamanın geri kalanı (AdminRoot) yüklenmedi', !scriptsBefore.includes('AdminRoot.js'), scriptsBefore.join(', '))
  step('giriş ekranı 390 px taşma yok', await shot(page, 'giris', 390))
  step('giriş ekranı 320 px taşma yok', await shot(page, 'giris', 320))
  step('giriş öncesi paket istenmedi', !requests.some((u) => u.includes('/gollazim-yayin/')))

  // 2) Yanlış şifre
  await signIn(page, login.username, 'ABCD-EFGH-JKMN-PQRS')
  await page.waitForSelector(sel('member-error'))
  step('yanlış şifre: genel hata', (await text(page, 'member-error')) === 'Kullanıcı adı veya şifre hatalı.', await text(page, 'member-error'))
  step('yanlış şifreden sonra oturum kaydı yok', Object.keys((await session(page)).session).length === 0)
  await shot(page, 'giris-hata', 320)

  // 3) Dağınık yazılmış doğru bilgilerle giriş
  await page.$eval(sel('member-password'), (el) => (el.value = ''))
  await page.reload({ waitUntil: 'networkidle0' })
  const started = Date.now()
  await signIn(page, `  ${login.username.toUpperCase()} `, ` ${login.password.toLowerCase().replace(/-/g, ' ')} `)
  await page.waitForSelector(sel('member-cards'), { timeout: 30000 })
  step('dağınık yazılmış kullanıcı adı ve şifreyle giriş', true, `${Date.now() - started} ms`)
  step('son güncelleme ve yayın no', /^Son güncelleme: (\d{1,2} \S+ \d{4} )?\d{2}:\d{2} \(TSİ\)$/.test(await text(page, 'member-updated')) && (await text(page, 'member-publish-no')) === 'Yayın no 1', `${await text(page, 'member-updated')} · ${await text(page, 'member-publish-no')}`)
  const stored = await session(page)
  const everything = JSON.stringify(stored)
  const plain = login.password.replace(/-/g, '')
  step('oturum deposunda yalnızca türetilmiş anahtar var; şifre ve kullanıcı adı yok', Object.keys(stored.session).join() === 'gollazim.uye.oturum' && !everything.includes(plain) && !everything.includes(login.password) && !everything.toLowerCase().includes(login.username) && Object.keys(stored.local).length === 0 && stored.cookie === '', Object.keys(JSON.parse(stored.session['gollazim.uye.oturum'])).join(','))
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  step('üye sayfası tarayıcıda veritabanı açmadı', databases.length === 0, JSON.stringify(databases))
  step('giriş sonrası uyarı metinleri paketten', (await text(page, 'member-disclaimer')).includes('bahis tavsiyesi değildir'))
  step('güncel pakette "güncel olmayabilir" uyarısı yok', (await page.$(sel('member-stale'))) === null)
  const navLinks = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')))
  step('düzende yalnızca iki sekme var', JSON.stringify(navLinks) === '["#/uye","#/uye/istatistik"]', JSON.stringify(navLinks))

  // 4) Kartlar, gün ve kategori seçimi
  const cardCount = await page.$$eval(sel('member-card'), (els) => els.length)
  step('kategori listesi çizildi', cardCount > 0, `${cardCount} kart`)
  step('analizler 390 px taşma yok', await shot(page, 'analiz', 390))
  step('analizler 320 px taşma yok', await shot(page, 'analiz', 320))
  const chips = await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))
  let overflowing = []
  let leaks = []
  for (const day of [0, 1]) {
    await page.click(sel(`member-day-${day}`))
    for (const chip of await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))) {
      await page.click(sel(chip))
      for (const width of [320, 390]) {
        await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
        const size = await overflow(page)
        if (size.scroll > size.inner) overflowing.push(`${day}/${chip}/${width}`)
      }
      const found = FORBIDDEN.exec(await visibleText(page))
      if (found) leaks.push(`${day}/${chip}: ${found[0]}`)
    }
  }
  step('her günün her kategorisi 320 ve 390 px taşma yok', overflowing.length === 0, overflowing.join(' ') || `${chips.length} kategori (bugün)`)
  step('kartlarda yasak terim yok (canlı sayfa)', leaks.length === 0, leaks.join(' '))
  await page.click(sel('member-day-1'))
  const yesterdayTitle = await text(page, 'member-day-title')
  await page.click(sel('member-day-0'))
  const todayTitle = await text(page, 'member-day-title')
  step('gün seçici günü değiştiriyor', yesterdayTitle !== todayTitle, `${todayTitle} ↔ ${yesterdayTitle}`)
  if (chips.includes('member-category-homeWin15')) {
    await page.click(sel('member-category-homeWin15'))
    await shot(page, 'taraf-gol', 320)
    const body = await page.evaluate(() => document.body.innerText)
    step('Taraf & Gol: "Model tabanlı" etiketi', body.includes('Model tabanlı') && !body.includes('Piyasa'))
  }
  await page.click(sel('member-day-1'))
  await shot(page, 'analiz-dun-sonuclar', 390)
  const outcomes = await page.$$eval(sel('member-outcome'), (els) => [...new Set(els.map((el) => el.textContent.trim()))])
  step('önceki günde sonuç işaretleri görünüyor', outcomes.some((o) => o.startsWith('✓')) && outcomes.some((o) => o.startsWith('✗')), outcomes.join(' | '))

  // 5) İstatistik
  await page.click('a[href="#/uye/istatistik"]')
  await page.waitForSelector(sel('member-overall'))
  const all = await text(page, 'member-overall')
  await page.click(sel('member-scope-shared'))
  const shared = await text(page, 'member-overall')
  step('istatistik: Tümü / Paylaşılan geçişi', all !== shared, `Tümü ${all} · Paylaşılan ${shared}`)
  await page.click(sel('member-scope-all'))
  for (const period of ['weekly', 'monthly', 'daily']) await page.click(sel(`member-period-${period}`))
  const statLeak = FORBIDDEN.exec(await visibleText(page))
  step('istatistikte yasak terim yok (canlı sayfa)', statLeak === null, statLeak?.[0] ?? '')
  step('istatistik 390 px taşma yok', await shot(page, 'istatistik', 390))
  step('istatistik 320 px taşma yok', await shot(page, 'istatistik', 320))

  // 6) Üye oturumunda admin yolları
  await page.goto(`${site}#/admin`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-frame'))
  step('üye oturumunda #/admin üye sayfasına yönleniyor', (await page.evaluate(() => location.hash)).startsWith('#/uye') && !requests.some((u) => /AdminRoot-/.test(u)), await page.evaluate(() => location.hash))

  // 7) Yeni yayın: aynı oturumda şifre sorulmadan
  packageFile = 'paket-2.json'
  await refreshNow(page)
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.trim() === 'Yayın no 2', { timeout: 15000 }, sel('member-publish-no'))
  step('yeni yayın oturum içinde, şifre sorulmadan açıldı', true, await text(page, 'member-publish-no'))

  // 8) Sayfa yenileme: oturum sürer
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-cards'))
  step('sayfa yenilenince oturum sürüyor', (await page.$(sel('member-login'))) === null)

  // 9) Eski paket uyarısı
  packageFile = 'paket-eski.json'
  await refreshNow(page)
  await page.waitForSelector(sel('member-stale'), { timeout: 15000 })
  step('eski pakette "güncel olmayabilir" uyarısı', (await text(page, 'member-stale')).includes('Bu veri güncel olmayabilir.'), `${await text(page, 'member-updated')}`)
  await shot(page, 'eski-paket', 320)
  packageFile = 'paket-2.json'

  // 10) Sekmeyi kapatıp yeni sekme açınca oturum biter
  await page.close()
  const second = await browser.newPage()
  watch(second)
  await second.setViewport({ width: 390, height: 844 })
  await second.goto(`${site}#/uye`, { waitUntil: 'networkidle0' })
  await second.waitForSelector(sel('member-login'))
  step('sekme kapatılıp yeni sekme açılınca giriş istiyor', Object.keys((await session(second)).session).length === 0)

  // 11) Çıkış
  await signIn(second, login.username, login.password)
  await second.waitForSelector(sel('member-cards'), { timeout: 30000 })
  await second.click(sel('member-logout'))
  await second.waitForSelector(sel('member-login'))
  const after = await session(second)
  step('Çıkış: oturum deposu boş, giriş ekranı', Object.keys(after.session).length === 0 && (await second.$(sel('member-cards'))) === null)
  await second.reload({ waitUntil: 'networkidle0' })
  step('Çıkıştan sonra yenileme oturumu geri getirmiyor', (await second.$(sel('member-login'))) !== null)

  // 12) Erişimi kaldırılan üye
  await signIn(second, login.username, login.password)
  await second.waitForSelector(sel('member-cards'), { timeout: 30000 })
  packageFile = 'paket-cikarilmis.json'
  await refreshNow(second)
  await second.waitForSelector(sel('member-notice'), { timeout: 15000 })
  step('yeni yayında erişimi kalkan üyenin oturumu kapandı', (await text(second, 'member-notice')) === 'Bu hesabın erişimi sona ermiş.' && Object.keys((await session(second)).session).length === 0)
  await signIn(second, login.username, login.password)
  await second.waitForSelector(sel('member-error'), { timeout: 30000 })
  step('çıkarılan üye yeni yayına giremiyor: genel hata', (await text(second, 'member-error')) === 'Kullanıcı adı veya şifre hatalı.')

  // 13) Paket yok
  packageFile = null
  await second.reload({ waitUntil: 'networkidle0' })
  await signIn(second, login.username, login.password)
  await second.waitForSelector(sel('member-error'), { timeout: 30000 })
  step('paket yokken ayrı hata metni', (await second.$eval(sel('member-error'), (el) => el.dataset.error)) === 'missing', await text(second, 'member-error'))
  await shot(second, 'giris-paket-yok', 320)

  // 14) Ağ istekleri
  const external = [...new Set(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')))]
  step('dış sunucuya istek yok', external.length === 0, external.join(' '))
  const paths = requests.filter((u) => u.startsWith(origin)).map((u) => new URL(u).pathname.replace(/-[A-Za-z0-9_-]{8}\./, '-*.'))
  const counts = {}
  for (const p of paths) counts[p] = (counts[p] ?? 0) + 1
  report.istekler = Object.entries(counts).map(([yol, adet]) => ({ yol, adet }))
  const packageRequests = requests.filter((u) => u.includes('/gollazim-yayin/'))
  step('paket her seferinde zaman damgasıyla istendi', packageRequests.length > 0 && packageRequests.every((u) => /\/gollazim-yayin\/paket\.json\?t=\d{13}$/.test(u)), `${packageRequests.length} istek`)
  const dataPaths = [...new Set(paths.filter((p) => !p.startsWith('/gollazim-site/')))]
  step('site dosyaları dışında yalnızca paket adresine gidildi', JSON.stringify(dataPaths) === '["/gollazim-yayin/paket.json"]', dataPaths.join(' '))
  step('uygulamanın geri kalanı (AdminRoot) hiç indirilmedi', !requests.some((u) => /AdminRoot-/.test(u)))

  // 15) Uygulamanın geri kalanı: üye oturumu olmayan sekmede eskisi gibi açılır
  const admin = await browser.newPage()
  await admin.setViewport({ width: 1280, height: 900 })
  await admin.goto(`${site}#/admin`, { waitUntil: 'networkidle0' })
  await admin.waitForSelector('[data-testid="csv-input"]', { timeout: 15000 })
  const menu = await admin.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()))
  step('üye oturumu yokken #/admin eskisi gibi açılıyor; menüde üye sayfası yok', menu.includes('ADMİN') && menu.includes('SKOR GİRİŞİ') && !menu.some((m) => /ÜYE/.test(m)), `${menu.length} menü öğesi`)
  await admin.goto(`${site}#/`, { waitUntil: 'networkidle0' })
  step('ana sayfa açılıyor', (await admin.evaluate(() => document.body.innerText)).includes('GÜNÜN ANALİZLERİ'))
} catch (error) {
  failed = true
  step('beklenmeyen hata', false, String(error?.message ?? error))
} finally {
  await browser.close()
  server.close()
  rmSync(profile, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(sampleDir, 'e2e-rapor.json'), JSON.stringify(report, null, 1) + '\n')
console.log(`\n${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · ${report.tarayici} · rapor: ${join(sampleDir, 'e2e-rapor.json')}`)
process.exit(failed ? 1 : 0)
