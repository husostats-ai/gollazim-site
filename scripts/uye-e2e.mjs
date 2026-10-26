// Geliştirme aracı: üye uygulamasını DERLENMİŞ hâliyle, gerçek tarayıcıda uçtan uca dener.
//
//   npm run build && npm run build:uye && UYE_BACKUP=samples/gollazim-yedek-….json npm run uye:e2e
//
// İki hedef aynı paketlerle sırayla denenir (UYE_HEDEF=eski | yeni | ikisi; varsayılan ikisi):
//   eski: admin sitesindeki üye rotası      /gollazim-site/#/uye   (dist/)
//   yeni: ayrı üye sitesi, kök rota         /gollazim-uye/#/       (dist-uye/)
// Yayındaki düzeni taklit eden küçük bir yerel sunucu açar: iki site ve şifreli paket
// (/gollazim-yayin/paket.json) aynı alan adındadır. Her hedef yeni, geçici bir tarayıcı
// profiliyle açılır; kullanıcının tarayıcı verisine dokunulmaz. İki hedef birlikte denenince
// ekran görüntüleri bayt bayt karşılaştırılır (eksik stil sınıfı varsa burada görünür).
// Şifreli örnek paketler ve sentetik test kullanıcısı her çalıştırmada GEÇİCİ bir klasörde
// üretilir ve deneme bitince silinir: kalıcı bir giriş dosyası bırakılmaz.
// Girdi: dist/, dist-uye/ ve UYE_BACKUP. Çıktı (kimlik içermez): UYE_ORNEK/ekran/, UYE_ORNEK/ekran-uye-sitesi/,
// UYE_ORNEK/e2e-rapor.json ve UYE_ORNEK/uye-sitesi-e2e-rapor.json
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { ALLOWED_PHRASES } from './lib/uye-cikti-denetim.mjs'

if (!process.env.UYE_BACKUP || !existsSync(resolve(process.env.UYE_BACKUP))) {
  console.error('UYE_BACKUP (JSON yedek) verilmeli.')
  process.exit(1)
}
const reportDir = resolve(process.env.UYE_ORNEK ?? 'samples/uye')
/** Paketlerin ve test kullanıcısının üretildiği geçici klasör; deneme bitince silinir */
const sampleDir = mkdtempSync(join(tmpdir(), 'gollazim-uye-ornek-'))

/** Geçici klasörde şifreli örnek paket (ve ilk çağrıda sentetik test kullanıcısı) üretir */
function generate(dir, env = {}) {
  // Yedekte öne çıkan seçim yoktur; sonuçlanmış her gün için 3 sentetik seçim eklenir.
  // Yedekteki seri adımları yok sayılır; 8 sentetik adım eklenir.
  execFileSync('npx', ['vitest', 'run', 'src/services/member/sample'], { env: { ...process.env, UYE_ORNEK: dir, UYE_ONE_CIKAN: '3', UYE_SERI: '8', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
}
generate(sampleDir, { UYE_N: '1' })
generate(sampleDir, { UYE_N: '2', UYE_DOSYA: 'paket-2.json' })
generate(sampleDir, { UYE_N: '3', UYE_DOSYA: 'paket-cikarilmis.json', UYE_CIKAR: '1' })
// Sürüm 7 paket (seri takibi alanı olmayan eski biçim): yeni üye sitesi bunu da açmalıdır.
generate(sampleDir, { UYE_N: '5', UYE_DOSYA: 'paket-v7.json', UYE_SURUM: '7' })
generate(sampleDir, { UYE_N: '4', UYE_DOSYA: 'paket-eski.json', UYE_AT: new Date(Date.now() - 30 * 3_600_000).toISOString() })
const dist = resolve('dist')
const memberDist = resolve('dist-uye')
const backupFile = resolve(process.env.UYE_BACKUP)
const puppeteerDir = resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107'))
const puppeteer = createRequire(join(puppeteerDir, 'x.js'))('puppeteer-core')
const login = JSON.parse(readFileSync(join(sampleDir, 'giris.json'), 'utf8'))

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json' }
/** Sunucunun paket adresinde verdiği dosya; null ise 404 */
let packageFile = 'paket.json'
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  let file = null
  if (path === '/gollazim-yayin/paket.json') file = packageFile && join(sampleDir, packageFile)
  else if (path.startsWith('/gollazim-site/')) file = normalize(join(dist, path.slice('/gollazim-site/'.length) || 'index.html'))
  else if (path.startsWith('/gollazim-uye/')) file = normalize(join(memberDist, path.slice('/gollazim-uye/'.length) || 'index.html'))
  const base = path.startsWith('/gollazim-yayin/') ? sampleDir : path.startsWith('/gollazim-uye/') ? memberDist : dist
  if (!file || !file.startsWith(base) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('Not Found')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

/** Denenen iki hedef: aynı üye uygulaması, farklı adres ve rota tabanı */
const TARGETS = {
  eski: { ad: 'admin sitesindeki üye rotası', prefix: '/gollazim-site/', home: '#/uye', stats: '#/uye/istatistik', streak: '#/uye/seri', shots: 'ekran', rapor: 'e2e-rapor.json', dist },
  yeni: { ad: 'ayrı üye sitesi', prefix: '/gollazim-uye/', home: '#/', stats: '#/istatistik', streak: '#/seri', shots: 'ekran-uye-sitesi', rapor: 'uye-sitesi-e2e-rapor.json', dist: memberDist },
}
const wanted = process.env.UYE_HEDEF ?? 'ikisi'
const targetNames = wanted === 'ikisi' ? ['eski', 'yeni'] : [wanted]
for (const name of targetNames) {
  if (!TARGETS[name]) throw new Error(`UYE_HEDEF tanınmıyor: ${name}`)
  if (!existsSync(join(TARGETS[name].dist, 'index.html'))) throw new Error(`${name}: derleme çıktısı yok (${TARGETS[name].dist}); önce derleyin.`)
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runTarget(T) {
console.log(`\n===== ${T.ad}: ${T.prefix}${T.home} =====`)
const site = `${origin}${T.prefix}`
const shots = join(reportDir, T.shots)
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })
packageFile = 'paket.json'
const profile = mkdtempSync(join(tmpdir(), 'gollazim-uye-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })

const report = { hedef: T.ad, adres: `${T.prefix}${T.home}`, tarayici: await browser.version(), adimlar: [], istekler: [], ekranlar: [] }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail && { ayrinti: detail }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const FORBIDDEN = /oran|piyasa|xg|csv|kaynak|footystats|bağlantı|https?:|www\.|odds|ortalama/

const requests = []
const watch = (page) => page.on('request', (r) => requests.push(r.url()))
const sel = (id) => `[data-testid="${id}"]`
const text = (page, id) => page.$eval(sel(id), (el) => el.textContent.trim())
// Piyasa yüzdesinin onaylı metinleri (kart etiketi "Piyasa %N", "Nasıl okunur?" başlığı ve not) birebir
// çıkarılır; başka yerde geçen "piyasa" yine yakalanır (derleme denetimindeki istisnanın karşılığı).
const [MARKET_LABEL, MARKET_NOTE] = ALLOWED_PHRASES
const visibleText = (page) =>
  page.evaluate(([label, note]) => [document.body.innerText.split(note).join(' ').replace(new RegExp(`(^|\\s)${label} %\\d{1,3}(?!\\d)`, 'g'), '$1').replace(new RegExp(`(^|\\n)${label}(?=\\n)`, 'g'), '$1'), ...[...document.querySelectorAll('[title],[aria-label],[alt],[placeholder]')].flatMap((el) => ['title', 'aria-label', 'alt', 'placeholder'].map((a) => el.getAttribute(a) ?? ''))].join(' ').toLocaleLowerCase('tr'), [MARKET_LABEL, MARKET_NOTE])
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
/** Tek bir kartın 390 px genişlikteki görüntüsü (sayfanın en üstünden) */
async function cardShot(page, id, name) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await new Promise((r) => setTimeout(r, 150))
  await (await page.$(sel(id))).screenshot({ path: join(shots, `${name}-390.png`) })
  report.ekranlar.push({ dosya: `${name}-390.png`, genislik: 390, tasma: 'yok' })
}
/** Giriş ekranındaki yasal uyarı penceresi açıksa "kabul ediyorum" düğmesine basar */
async function acceptLegal(page) {
  await page.waitForSelector(sel('member-username'))
  if (await page.$(sel('member-legal'))) await page.$eval(sel('member-legal-accept'), (el) => el.click())
  await page.waitForFunction(() => !document.querySelector('[data-testid="member-legal"]') && !document.querySelector('[data-testid="member-username"]').disabled)
}
async function signIn(page, username, password) {
  await acceptLegal(page)
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
  await page.goto(`${site}${T.home}`, { waitUntil: 'networkidle0' })

  // 1) Giriş ekranı
  await page.waitForSelector(sel('member-login'))
  const robots = await page.$eval('meta[name="robots"]', (el) => el.content)
  step('giriş ekranı açıldı; noindex etiketi var', robots.includes('noindex'), robots)
  const head = await page.evaluate(() => ({ title: document.title, icon: document.querySelector('link[rel="icon"]')?.getAttribute('href'), lang: document.documentElement.lang }))
  step('başlık, simge ve dil admin sitesiyle aynı', head.title === 'GOLLAZIM' && head.icon === './favicon.png' && head.lang === 'tr', JSON.stringify(head))
  const assets = await page.evaluate(async () => Promise.all(['./favicon.png', './logo-256.png'].map(async (u) => (await fetch(u)).status)))
  step('simge ve logo yükleniyor', assets.join() === '200,200', assets.join())
  const links = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')))
  step('giriş ekranında gezinme bağlantısı yok', links.length === 0, JSON.stringify(links))

  // 1a) Yasal uyarı penceresi: kabul edilene kadar form etkisiz, hiçbir istek gitmez, hiçbir şey saklanmaz
  const legalState = () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="member-legal"]')
      return {
        open: dialog !== null,
        role: dialog?.getAttribute('role'),
        modal: dialog?.getAttribute('aria-modal'),
        focusInside: dialog?.contains(document.activeElement) ?? false,
        focused: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName,
        declined: document.querySelector('[data-testid="member-legal-declined"]')?.textContent ?? null,
        scrollLocked: getComputedStyle(document.documentElement).overflow === 'hidden',
        username: document.querySelector('[data-testid="member-username"]').value,
        password: document.querySelector('[data-testid="member-password"]').value,
        disabled: [...document.querySelectorAll('[data-testid="member-login-content"] input, [data-testid="member-login-content"] button')].every((el) => el.disabled),
        inert: document.querySelector('[data-testid="member-login-content"]').inert,
        busy: document.querySelector('[data-testid="member-progress"]') !== null,
        text: dialog?.innerText ?? '',
        buttons: [...(dialog?.querySelectorAll('button') ?? [])].map((b) => Math.round(b.getBoundingClientRect().height)),
        // Başlık, 18 yaş satırı ve iki düğme kaydırmadan ekranda mı; 18 yaş satırı kaydırılan gövdenin dışında mı
        pinned: ['member-legal-title', 'member-legal-age'].map((id) => document.getElementById(id)).concat([...(dialog?.querySelectorAll('button') ?? [])]).every((el) => {
          const box = el?.getBoundingClientRect()
          return !!box && box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth
        }),
        age: document.querySelector('[data-testid="member-legal-age"]')?.textContent ?? null,
        ageOutsideBody: !document.querySelector('[data-testid="member-legal-body"]')?.contains(document.querySelector('[data-testid="member-legal-age"]')),
        ageAboveButtons: (document.querySelector('[data-testid="member-legal-age"]')?.getBoundingClientRect().bottom ?? Infinity) <= (document.querySelector('[data-testid="member-legal-accept"]')?.getBoundingClientRect().top ?? -Infinity),
        fits: dialog ? dialog.getBoundingClientRect().left >= 0 && dialog.getBoundingClientRect().right <= window.innerWidth && dialog.getBoundingClientRect().top >= 0 && dialog.getBoundingClientRect().bottom <= window.innerHeight : false,
      }
    })
  const storageEmpty = async () => {
    const s = await session(page)
    return Object.keys(s.session).length === 0 && Object.keys(s.local).length === 0 && s.cookie === '' && (await page.evaluate(async () => (await indexedDB.databases()).length)) === 0
  }
  const requestsBeforeLegal = requests.length
  let legal = await legalState()
  step('yasal uyarı penceresi açık: role="dialog", aria-modal, odak kabul düğmesinde', legal.open && legal.role === 'dialog' && legal.modal === 'true' && legal.focused === 'member-legal-accept', `odak: ${legal.focused}`)
  step('pencere metni: başlık, üç paragraf, 18 yaş satırı, iki düğme', legal.text.startsWith('⚠️ Yasal Uyarı') && legal.text.includes('Burada yazanlar bahis tavsiyesi değildir ve bahse yönlendirmez.') && legal.text.includes('Bu sayfayı yalnızca 18 yaşından büyükler kullanabilir.') && legal.text.includes('18 yaşından büyüğüm, kabul ediyorum') && legal.text.trimEnd().endsWith('Kabul etmiyorum'))
  const legalLeak = FORBIDDEN.exec(legal.text.toLocaleLowerCase('tr'))
  step('pencere metninde yasak terim yok', legalLeak === null, legalLeak?.[0] ?? '')
  step('pencere açıkken form etkisiz (inert, bütün alanlar pasif) ve arka plan kaydırılamıyor', legal.inert && legal.disabled && legal.scrollLocked)
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: width === 320 ? 568 : 844, deviceScaleFactor: 2 })
    await sleep(150)
    const size = await overflow(page)
    const at = await legalState()
    await page.screenshot({ path: join(shots, `yasal-uyari-${width}.png`) })
    report.ekranlar.push({ dosya: `yasal-uyari-${width}.png`, genislik: width, tasma: size.scroll > size.inner ? `${size.scroll} > ${size.inner}` : 'yok' })
    step(`yasal uyarı ${width} px: taşma yok, pencere ekrana sığıyor, düğmeler en az 44 px`, size.scroll <= size.inner && at.fits && at.buttons.length === 2 && at.buttons.every((h) => h >= 44), `düğme yükseklikleri ${at.buttons.join(', ')} px`)
    step(`yasal uyarı ${width} px: başlık, 18 yaş satırı ve iki düğme kaydırmadan ekranda; 18 yaş satırı gövdenin dışında, düğmelerin üstünde`, at.pinned && at.ageOutsideBody && at.ageAboveButtons && at.age === 'Bu sayfayı yalnızca 18 yaşından büyükler kullanabilir.', at.age ?? 'satır yok')
  }
  // Kısa ekranda metin pencerenin içinde kayar; düğmeler görünür kalır.
  await page.setViewport({ width: 320, height: 380, deviceScaleFactor: 2 })
  await sleep(150)
  const short = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="member-legal-body"]')
    const accept = document.querySelector('[data-testid="member-legal-accept"]').getBoundingClientRect()
    const decline = document.querySelector('[data-testid="member-legal-decline"]').getBoundingClientRect()
    body.scrollTop = 9999
    return { scrollable: body.scrollHeight > body.clientHeight, scrolled: body.scrollTop > 0, visible: accept.top >= 0 && decline.bottom <= window.innerHeight, page: document.documentElement.scrollWidth <= window.innerWidth }
  })
  step('kısa ekranda (320×380) metin pencere içinde kayıyor, düğmeler ekranda', short.scrollable && short.scrolled && short.visible && short.page, JSON.stringify(short))
  step('kısa ekranda (320×380) 18 yaş satırı da kaydırmadan ekranda', (await legalState()).pinned)
  // Yatay telefon: başlık, 18 yaş satırı ve düğmeler ekranda; diğer paragraflar pencere içinde kayar.
  await page.setViewport({ width: 568, height: 320, deviceScaleFactor: 2 })
  await sleep(150)
  const landscape = await legalState()
  const landscapeSize = await overflow(page)
  const landscapeBody = await page.$eval(sel('member-legal-body'), (body) => {
    body.scrollTop = 0
    const before = body.scrollTop
    body.scrollTop = 9999
    const moved = body.scrollTop > before
    body.scrollTop = 0
    return { height: Math.round(body.clientHeight), scrollable: body.scrollHeight > body.clientHeight, moved }
  })
  await page.screenshot({ path: join(shots, 'yasal-uyari-yatay-568.png') })
  report.ekranlar.push({ dosya: 'yasal-uyari-yatay-568.png', genislik: 568, tasma: landscapeSize.scroll > landscapeSize.inner ? `${landscapeSize.scroll} > ${landscapeSize.inner}` : 'yok' })
  step('yatay modda (568×320) pencere kullanılabilir: taşma yok, başlık, 18 yaş satırı ve düğmeler ekranda, metin pencere içinde kayıyor', landscapeSize.scroll <= landscapeSize.inner && landscape.fits && landscape.pinned && landscape.buttons.every((h) => h >= 44) && landscapeBody.scrollable && landscapeBody.moved && landscapeBody.height >= 40, JSON.stringify(landscapeBody))
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await sleep(150)
  // Klavye: yazı ve Enter forma ulaşmaz, Esc kapatmaz, Tab pencerenin içinde döner
  await page.keyboard.press('Escape')
  await page.keyboard.type('deneme')
  const order = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    order.push((await legalState()).focused)
  }
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  order.push((await legalState()).focused)
  legal = await legalState()
  step('Esc pencereyi kapatmıyor; Tab ve Shift+Tab odağı pencerenin içinde döndürüyor', legal.open && order.every((id) => id === 'member-legal-accept' || id === 'member-legal-decline') && new Set(order).size === 2, order.join(' → '))
  // Fareyle forma tıklama ve doğrudan gönderme denemesi de etkisizdir
  await page.mouse.click(195, 300)
  await page.evaluate(() => {
    document.querySelector('[data-testid="member-username"]').focus()
    document.querySelector('[data-testid="member-submit"]').click()
    document.querySelector('[data-testid="member-login"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  // Odak "Kabul etmiyorum" düğmesindeyken yazı ve Enter: Enter formu göndermez, yalnızca o düğmeyi çalıştırır.
  await page.$eval(sel('member-legal-decline'), (el) => el.focus())
  await page.keyboard.type('deneme')
  await page.keyboard.press('Enter')
  await sleep(600)
  legal = await legalState()
  step('kabul edilmeden yazı, Enter, tıklama ve gönderme forma ulaşmıyor: alanlar boş, giriş başlamadı', legal.open && legal.username === '' && legal.password === '' && !legal.busy && legal.focusInside, `odak: ${legal.focused}`)
  step('"Kabul etmiyorum" pencereyi kapatmıyor; "Devam etmek için onay gerekir." yazıyor', legal.open && legal.declined === 'Devam etmek için onay gerekir.' && legal.inert, legal.declined ?? 'uyarı yok')
  await shot(page, 'yasal-uyari-red', 320)
  const duringLegal = requests.slice(requestsBeforeLegal)
  step('kabul edilmeden hiçbir ağ isteği gitmedi (paket dahil)', duringLegal.length === 0 && !requests.some((u) => u.includes('/gollazim-yayin/')), `${duringLegal.length} istek`)
  step('pencere açıkken depolama boş', await storageEmpty())
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.$eval(sel('member-legal-accept'), (el) => el.click())
  await sleep(200)
  const accepted = await page.evaluate(() => ({ open: document.querySelector('[data-testid="member-legal"]') !== null, inert: document.querySelector('[data-testid="member-login-content"]').inert, focused: document.activeElement?.getAttribute('data-testid'), disabled: document.querySelector('[data-testid="member-username"]').disabled, overflow: document.documentElement.style.overflow }))
  step('kabul edilince pencere kapanıyor, form açılıyor, odak kullanıcı adında, kaydırma geri geliyor', !accepted.open && !accepted.inert && !accepted.disabled && accepted.focused === 'member-username' && accepted.overflow === '', JSON.stringify(accepted))
  step('onay hiçbir yere yazılmadı: depolama hâlâ boş, istek yok', (await storageEmpty()) && requests.length === requestsBeforeLegal)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-login'))
  step('sayfa yenilenince pencere yeniden çıkıyor', (await legalState()).open)
  await acceptLegal(page)

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

  // Giriş yapılmamışken bilinmeyen adresler de köke döner (adres çubuğu dahil)
  const signedOutLanding = []
  for (const hash of T.prefix === '/gollazim-uye/' ? ['#/admin', '#/istatistik', '#/skor-girisi', '#/uye', '#/olmayan'] : ['#/uye/istatistik', '#/uye/olmayan']) {
    await page.goto(`${site}${hash}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector(sel('member-login'))
    await sleep(150)
    signedOutLanding.push(`${hash}→${await page.evaluate(() => location.hash)}`)
  }
  step('giriş yapılmamışken bilinmeyen adresler köke yönleniyor', signedOutLanding.every((l) => l.endsWith(`→${T.home}`)) && (await page.$(sel('member-login'))) !== null, signedOutLanding.join('  '))

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
  step('düzende yalnızca üç sekme var (Analizler, İstatistik, Seri Takibi)', JSON.stringify(navLinks) === JSON.stringify([T.home, T.stats, T.streak]), JSON.stringify(navLinks))

  // 4) Kartlar, gün ve kategori seçimi
  const cardCount = await page.$$eval(sel('member-card'), (els) => els.length)
  step('kategori listesi çizildi', cardCount > 0, `${cardCount} kart`)
  const labels = await page.$$eval(sel('member-percent-label'), (els) => [...new Set(els.map((el) => el.textContent.trim()))])
  step('büyük yüzdenin altında sabit etiket var', labels.length === 1 && labels[0] === 'Geçmiş maçlarda görülme sıklığı' && (await page.$$eval(sel('member-percent-label'), (els) => els.length)) === cardCount, labels.join(' | '))
  step('kartların üstünde açıklama satırı', (await text(page, 'member-percent-note')).startsWith('Yüzdeler geçmiş verilere ve model hesaplarına dayanan özetlerdir;'), await text(page, 'member-percent-note'))
  // %100 + geçmiş veri Az: yüzde sönük ve küçük, rozet belirgin (gerçek veride bu kartlar var)
  const styles = await page.evaluate(() => {
    const read = (card) => {
      const percent = card.querySelector('[data-testid="member-percent"]')
      const badge = card.querySelector('[data-testid="member-reliability"]')
      return { text: percent.textContent.trim(), size: parseFloat(getComputedStyle(percent).fontSize), color: getComputedStyle(percent).color, badgeSize: parseFloat(getComputedStyle(badge).fontSize), badgeWeight: getComputedStyle(badge).fontWeight, badge: badge.textContent.trim() }
    }
    const cards = [...document.querySelectorAll('[data-testid="member-card"]')]
    return { soluk: cards.filter((c) => c.dataset.overstated === 'true').map(read), olagan: cards.filter((c) => c.dataset.overstated !== 'true').map(read) }
  })
  const dim = styles.soluk[0]
  const normal = styles.olagan[0]
  step('%100 + geçmiş veri Az: yüzde daha küçük ve sönük, rozet daha büyük ve kalın', !!dim && !!normal && dim.text === '%100' && dim.badge.includes('Az') && dim.size < normal.size && dim.color !== normal.color && dim.badgeSize > normal.badgeSize && Number(dim.badgeWeight) > Number(normal.badgeWeight), dim && normal ? `sönük ${dim.size}px ${dim.color} · olağan ${normal.size}px ${normal.color} · rozet ${dim.badgeSize}px/${dim.badgeWeight} ↔ ${normal.badgeSize}px/${normal.badgeWeight} · ${styles.soluk.length} sönük, ${styles.olagan.length} olağan kart` : 'bu kategoride örnek yok')
  const isLow = (c) => /^⚠?\s*Geçmiş veri:\s*Az/.test(c.badge)
  step('sönük gösterim yalnızca %100 + geçmiş veri Az kartlarda', styles.soluk.every((c) => c.text === '%100' && isLow(c)) && styles.olagan.every((c) => !(c.text === '%100' && isLow(c))))
  const allBadges = [...styles.soluk, ...styles.olagan].map((c) => c.badge.replace(/\s+/g, ' '))
  const measured = allBadges.filter((b) => /Geçmiş veri: ?(Az|Orta|Çok)/.test(b))
  step('rozet "Geçmiş veri: Az / Orta / Çok · en az N maç"; eski "Güvenilirlik" terimi yok', measured.length > 0 && measured.every((b) => /^⚠? ?Geçmiş veri: ?(Az|Orta|Çok) ?· en az \d+ maç$/.test(b)) && allBadges.every((b) => !/Güvenilirlik|Düşük|Yüksek/.test(b)), [...new Set(allBadges)].slice(0, 4).join(' | '))
  // "Aynı maçın diğer önerileri" satırı ve "Nasıl okunur?" kutusu
  const others = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="member-card"]')]
    const rows = cards.map((card) => card.querySelector('[data-testid="member-others"]'))
    const first = rows.find(Boolean)
    const big = cards[0].querySelector('[data-testid="member-percent"]')
    return {
      cards: cards.length,
      withRow: rows.filter(Boolean).length,
      sample: first?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      rowSize: first ? parseFloat(getComputedStyle(first).fontSize) : 0,
      rowColor: first ? getComputedStyle(first).color : '',
      bigSize: parseFloat(getComputedStyle(big).fontSize),
      // Satırdaki yüzdeler: %100 + geçmiş veri Az olanlar vurgusuz (soluk), diğerleri yarı kalın ve beyaz
      percents: [...document.querySelectorAll('[data-testid="member-other"]')].map((el) => {
        const percent = [...el.querySelectorAll('span')].find((span) => span.textContent.trim().startsWith('%'))
        return { dim: el.dataset.overstated === 'true', text: percent.textContent.trim(), weight: Number(getComputedStyle(percent).fontWeight), color: getComputedStyle(percent).color }
      }),
    }
  })
  step('"Aynı maçın diğer önerileri" satırı var; küçük ve soluk', others.withRow > 0 && others.sample.startsWith('Aynı maçın diğer önerileri:') && others.rowSize <= 11 && others.rowSize < others.bigSize / 2, `${others.withRow}/${others.cards} kartta · ${others.rowSize}px ${others.rowColor} · "${others.sample.slice(0, 90)}"`)
  const dimOthers = others.percents.filter((p) => p.dim)
  const plainOthers = others.percents.filter((p) => !p.dim)
  step('satırdaki %100 + geçmiş veri Az yüzdeler de sönük; diğerleri vurgulu', dimOthers.length > 0 && plainOthers.length > 0 && dimOthers.every((p) => p.text === '%100' && p.weight < 500 && p.color === others.rowColor) && plainOthers.every((p) => p.weight >= 600 && p.color !== others.rowColor), `${dimOthers.length} sönük, ${plainOthers.length} vurgulu`)
  // Kapalı kutu yalnızca başlık satırı kadar yer tutar.
  const howto = await page.$eval(sel('member-howto'), (el) => ({ open: el.open, summary: el.querySelector('summary').textContent.trim(), height: el.offsetHeight }))
  step('"Nasıl okunur?" kutusu kapalı geliyor', !howto.open && howto.height < 60 && howto.summary === 'Nasıl okunur?', `${howto.height} px`)
  await page.click(`${sel('member-howto')} summary`)
  const opened = await page.$eval(sel('member-howto'), (el) => ({ open: el.open, height: el.querySelector('[data-testid="member-howto-body"]').offsetHeight, text: el.textContent }))
  step('"Nasıl okunur?" tıklanınca açılıyor', opened.open && opened.height > 200 && opened.text.includes('Hiçbiri garanti değildir') && opened.text.includes('Geçmiş maçlarda görülme sıklığı'), `${opened.height} px`)
  const howtoLeak = FORBIDDEN.exec(await visibleText(page))
  step('açık "Nasıl okunur?" ile sayfada yasak terim yok', howtoLeak === null, howtoLeak?.[0] ?? '')
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 })
    await new Promise((r) => setTimeout(r, 150))
    const size = await overflow(page)
    const inside = await page.evaluate(() => [...document.querySelectorAll('[data-testid="member-howto"], [data-testid="member-others"], [data-testid="member-other"]')].every((el) => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth + 0.5 }))
    step(`açık "Nasıl okunur?" ve öneri satırları ${width} px'te taşmıyor`, size.scroll <= size.inner && inside, `${size.scroll} / ${size.inner}`)
    await page.screenshot({ path: join(shots, `nasil-okunur-acik-${width}.png`), fullPage: true })
    report.ekranlar.push({ dosya: `nasil-okunur-acik-${width}.png`, genislik: width, tasma: size.scroll > size.inner ? 'VAR' : 'yok' })
  }
  await page.click(`${sel('member-howto')} summary`)

  // Piyasa yüzdesi (sürüm 11): yalnızca değer varken, Model satırının altında; "?" notu başlık bloğunun altında tam genişlikte
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  const marketCards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="member-card"]')].map((card) => {
        const line = card.querySelector('[data-testid="member-market"]')
        // Yıldızlar bir düğmenin içindedir; ölçü düğmeyi saran blokla alınır.
        const stars = card.querySelector('[data-testid="member-stars"]').parentElement
        const prev = stars.previousElementSibling
        return {
          line: line ? line.querySelector('span').textContent.replace(/\s+/g, ' ').trim() : null,
          toggles: card.querySelectorAll('[data-testid="member-market-toggle"]').length,
          // Yıldızların üstündeki boşluk: değer yoksa satır yer tutmaz (yalnızca mt-1.5 = 6 px)
          gap: Math.round(stars.getBoundingClientRect().top - prev.getBoundingClientRect().bottom),
          prev: prev.dataset.testid,
        }
      }),
    )
  const withMarket = (await marketCards()).filter((c) => c.line !== null)
  step('piyasa satırı: "Piyasa %N" ve tek "?" düğmesi', withMarket.length > 0 && withMarket.every((c) => new RegExp(`^${MARKET_LABEL} %\\d{1,3}$`).test(c.line) && c.toggles === 1), `${withMarket.length} kartta · ${withMarket[0]?.line}`)
  const marketToggle = sel('member-market-toggle')
  const note = () =>
    page.evaluate(() => {
      const card = document.querySelector('[data-testid="member-market-toggle"]').closest('[data-testid="member-card"]')
      const el = card.querySelector('[data-testid="member-market-note"]')
      const head = card.querySelector('[data-testid="member-percent"]').parentElement.parentElement
      const toggle = card.querySelector('[data-testid="member-market-toggle"]')
      if (!el) return { open: false, expanded: toggle.getAttribute('aria-expanded') }
      const box = el.getBoundingClientRect()
      const cardBox = card.getBoundingClientRect()
      const padding = parseFloat(getComputedStyle(card).paddingLeft)
      return {
        open: true,
        expanded: toggle.getAttribute('aria-expanded'),
        controls: toggle.getAttribute('aria-controls') === el.id,
        text: el.textContent.trim(),
        below: box.top >= head.getBoundingClientRect().bottom - 0.5,
        full: Math.abs(box.width - (cardBox.width - 2 * padding - 2)) <= 2,
        inside: box.left >= cardBox.left && box.right <= cardBox.right + 0.5,
      }
    })
  const closedNote = await note()
  step('"?" notu kapalı geliyor (aria-expanded=false, not çizilmemiş)', !closedNote.open && closedNote.expanded === 'false')
  await page.click(marketToggle)
  const openNote = await note()
  step('"?" tıklanınca not açılıyor: onaylı cümle, başlık bloğunun altında, kart genişliğinde', openNote.open && openNote.expanded === 'true' && openNote.controls && openNote.text === MARKET_NOTE && openNote.below && openNote.full && openNote.inside, JSON.stringify({ ...openNote, text: openNote.text?.slice(0, 40) }))
  await page.click(marketToggle)
  step('"?" yeniden tıklanınca not kapanıyor', !(await note()).open)
  await page.focus(marketToggle)
  await page.keyboard.press('Enter')
  step('"?" klavyeyle (Enter) açılıyor', (await note()).open)
  for (const width of [320, 360, 390]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 })
    await new Promise((r) => setTimeout(r, 150))
    const size = await overflow(page)
    const fits = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="member-market"], [data-testid="member-market-toggle"], [data-testid="member-market-note"]')].every((el) => {
        const box = el.getBoundingClientRect()
        const card = el.closest('[data-testid="member-card"]').getBoundingClientRect()
        return box.left >= card.left && box.right <= card.right + 0.5 && box.right <= window.innerWidth + 0.5
      }),
    )
    const nextNote = await note()
    step(`piyasa satırı ve açık not ${width} px'te taşmıyor`, size.scroll <= size.inner && fits && nextNote.open && nextNote.full, `${size.scroll} / ${size.inner}`)
    if (width === 320) {
      await page.evaluate(() => (document.querySelector('header').style.position = 'static'))
      await (await page.$(`${sel('member-card')}:has(${sel('member-market-note')})`)).screenshot({ path: join(shots, 'kart-piyasa-not-320.png') })
      await page.evaluate(() => (document.querySelector('header').style.position = ''))
      report.ekranlar.push({ dosya: 'kart-piyasa-not-320.png', genislik: 320, tasma: 'yok' })
    }
  }
  await page.click(marketToggle)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  // Değeri olmayan kart: satır, düğme ve boşluk yok (oransız listeler; oranlı listede değeri olmayan kart varsa o da)
  const bareCards = []
  for (const chip of await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))) {
    await page.click(sel(chip))
    await new Promise((r) => setTimeout(r, 60))
    for (const card of await marketCards()) if (card.line === null) bareCards.push({ chip, ...card })
  }
  step(
    'değeri olmayan kartta piyasa satırı, düğme ve boşluk yok',
    bareCards.length > 0 && bareCards.every((c) => c.toggles === 0 && c.gap === 6 && c.prev !== 'member-market'),
    `${bareCards.length} kart · ${[...new Set(bareCards.map((c) => c.chip.replace('member-category-', '')))].join(', ')} · boşluk ${[...new Set(bareCards.map((c) => c.gap))].join('/')} px`,
  )
  await page.click(sel((await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid)))[0]))

  // Yüzde çubuğu: yalnızca kartta yazan değerler; her noktanın bir etiketi var, noktalar çubuğun içinde
  const spreads = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="member-spread"]')].map((el) => {
      const bar = el.firstElementChild.getBoundingClientRect()
      const dots = [...el.querySelectorAll('[data-testid="member-spread-dot"]')]
      return {
        dots: dots.length,
        labels: el.querySelectorAll('[data-testid="member-spread-label"]').length,
        gap: el.querySelector('[data-testid="member-spread-gap"]')?.textContent ?? null,
        inside: dots.every((d) => { const b = d.getBoundingClientRect(); return b.left >= bar.left - 6 && b.right <= bar.right + 6 }),
      }
    }),
  )
  step('yüzde çubuğu: yalnızca 2+ değerde; nokta sayısı = etiket sayısı, fark satırı var, noktalar çubukta', spreads.length > 0 && spreads.every((s) => s.dots === s.labels && s.dots >= 2 && s.gap !== null && s.inside), `${spreads.length} kart · ${[...new Set(spreads.map((s) => s.dots))].join('/')} nokta`)

  // Yıldız açıklaması: klavyeyle aç / kapa, Esc ve dışarı dokunma kapatır
  const starsState = () =>
    page.evaluate(() => {
      const button = document.querySelector('[data-testid="member-stars"]')
      const noteEl = button.parentElement.querySelector('[data-testid="member-stars-note"]')
      const box = noteEl?.getBoundingClientRect()
      return { expanded: button.getAttribute('aria-expanded'), open: !!noteEl, controls: noteEl ? button.getAttribute('aria-controls') === noteEl.id : null, inView: box ? box.left >= 0 && box.right <= window.innerWidth + 0.5 : null, text: noteEl?.textContent ?? '' }
    })
  await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 2 })
  await page.focus(sel('member-stars'))
  await page.keyboard.press('Enter')
  const starsOpen = await starsState()
  step('yıldız açıklaması klavyeyle (Enter) açılıyor; bağlı, 320 px ekranda taşmıyor', starsOpen.open && starsOpen.expanded === 'true' && starsOpen.controls && starsOpen.inView && !FORBIDDEN.test(starsOpen.text.toLocaleLowerCase('tr')), starsOpen.text.slice(0, 60))
  await page.keyboard.press('Escape')
  step('yıldız açıklaması Esc ile kapanıyor', !(await starsState()).open)
  await page.keyboard.press('Space')
  const spaceOpen = (await starsState()).open
  await page.keyboard.press('Space')
  step('yıldız açıklaması klavyeyle (Boşluk) açılıp kapanıyor', spaceOpen && !(await starsState()).open)
  await page.keyboard.press('Enter')
  await page.click(sel('member-day-title'))
  step('yıldız açıklaması dışarı dokununca kapanıyor', !(await starsState()).open)

  // Diğer analizler: varsayılan kapalı; açılınca içerik görünür, başlık yerinden oynamaz
  const othersState = () =>
    page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="member-others-toggle"]')
      const region = document.getElementById(toggle.getAttribute('aria-controls'))
      return { expanded: toggle.getAttribute('aria-expanded'), title: toggle.textContent.trim(), height: region.offsetHeight, visible: getComputedStyle(region).visibility === 'visible', top: Math.round(toggle.getBoundingClientRect().top), scroll: Math.round(window.scrollY) }
    })
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.evaluate(() => document.querySelector('[data-testid="member-others-toggle"]').scrollIntoView({ block: 'center' }))
  await new Promise((r) => setTimeout(r, 100))
  const othersClosed = await othersState()
  step('"Diğer analizler (N)" varsayılan kapalı ve yer tutmuyor', othersClosed.expanded === 'false' && othersClosed.height === 0 && !othersClosed.visible && /^Diğer analizler \(\d+\) ▾$/.test(othersClosed.title), othersClosed.title)
  await page.click(sel('member-others-toggle'))
  await new Promise((r) => setTimeout(r, 350))
  const othersOpen = await othersState()
  step('tıklanınca açılıyor (▴); başlık ve sayfa kaydırması yerinde kalıyor', othersOpen.expanded === 'true' && othersOpen.height > 0 && othersOpen.visible && othersOpen.title.endsWith('▴') && othersOpen.top === othersClosed.top && othersOpen.scroll === othersClosed.scroll, `${othersOpen.height} px`)
  await page.click(sel('member-others-toggle'))
  await new Promise((r) => setTimeout(r, 350))
  step('yeniden tıklanınca kapanıyor', (await othersState()).height === 0)

  // Öneri satırlı bir kartın yakın görüntüsü (320 px)
  await page.setViewport({ width: 320, height: 844, deviceScaleFactor: 2 })
  await page.evaluate(() => (document.querySelector('header').style.position = 'static'))
  await (await page.$(sel('member-card'))).screenshot({ path: join(shots, 'kart-diger-oneriler-320.png') })
  await page.evaluate(() => (document.querySelector('header').style.position = ''))
  report.ekranlar.push({ dosya: 'kart-diger-oneriler-320.png', genislik: 320, tasma: 'yok' })
  // Yasal uyarı sayfanın en altında, mobil boyutta görünür
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await new Promise((r) => setTimeout(r, 150))
    const footer = await page.$eval(sel('member-footer'), (el) => {
      const box = el.getBoundingClientRect()
      const last = [...document.querySelectorAll('[data-testid="member-card"]')].pop().getBoundingClientRect()
      return { text: el.textContent, inView: box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth, below: box.top >= last.bottom, height: box.height, color: getComputedStyle(el.firstElementChild).color, size: getComputedStyle(el.firstElementChild).fontSize }
    })
    step(`yasal uyarı sayfanın en altında görünür (${width} px)`, footer.inView && footer.below && footer.height > 20 && footer.text.includes('bahis tavsiyesi değildir') && footer.text.includes('18+'), `${footer.size}, ${footer.color}, yükseklik ${Math.round(footer.height)} px`)
    if (width === 320) {
      await page.screenshot({ path: join(shots, 'alt-yasal-uyari-320.png') })
      report.ekranlar.push({ dosya: 'alt-yasal-uyari-320.png', genislik: 320, tasma: 'yok' })
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  step('analizler 390 px taşma yok', await shot(page, 'analiz', 390))
  step('analizler 320 px taşma yok', await shot(page, 'analiz', 320))
  const chips = await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))
  let overflowing = []
  let leaks = []
  // Sayfa uzun ve üst menü yapışkan: fare tıklaması menüye denk gelebildiği için burada DOM tıklaması kullanılır.
  const tap = (id) => page.$eval(sel(id), (el) => el.click())
  const dayCount = (await page.$$('[data-testid^="member-day-"][role="tab"]')).length
  let hiddenDays = []
  for (let day = 0; day < dayCount; day++) {
    await tap(`member-day-${day}`)
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(`member-day-${day}`))
    for (const chip of await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))) {
      await tap(chip)
      await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(chip))
      for (const width of [320, 390]) {
        await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
        const size = await overflow(page)
        if (size.scroll > size.inner) overflowing.push(`${day}/${chip}/${width}`)
      }
      // Gün şeridi kendi içinde yatay kayar; seçili günün düğmesi her zaman ekranda kalır.
      const inView = await page.$eval(sel(`member-day-${day}`), (el) => {
        const box = el.getBoundingClientRect()
        return box.left >= 0 && box.right <= window.innerWidth
      })
      if (!inView) hiddenDays.push(`${day}/${chip}`)
      const found = FORBIDDEN.exec(await visibleText(page))
      if (found) leaks.push(`${day}/${chip}: ${found[0]}`)
    }
  }
  step('her günün her kategorisi 320 ve 390 px taşma yok', overflowing.length === 0, overflowing.join(' ') || `${chips.length} kategori (bugün)`)
  step('kartlarda yasak terim yok (canlı sayfa)', leaks.length === 0, leaks.join(' '))
  step('gün şeridi: seçili gün her genişlikte görünür (şerit yatay kayar)', hiddenDays.length === 0, hiddenDays.join(' ') || `${dayCount} gün`)

  // İY 0.5 ÜST (*) notu: yalnızca İY kartında ve kartın "diğer önerileri"nde hem 2.5 ÜST hem 2. YARI 0.5 ÜST varsa.
  // 360 ve 390 px'te notun kart ve ekran içinde kaldığı, sayfanın yatay taşmadığı ölçülür.
  const ht05 = { cards: 0, withNote: 0, wrong: [], elsewhere: [], overflow: [], lines: new Set() }
  for (let day = 0; day < dayCount; day++) {
    await tap(`member-day-${day}`)
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(`member-day-${day}`))
    for (const chip of await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))) {
      await tap(chip)
      await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(chip))
      if (chip !== 'member-category-ht05') {
        const stray = await page.$$eval('[data-testid="member-ht05-note"], [data-testid="member-ht05-note-mark"]', (els) => els.length)
        if (stray > 0) ht05.elsewhere.push(`${day}/${chip.replace('member-category-', '')}: ${stray}`)
        continue
      }
      for (const width of [360, 390]) {
        await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
        const cards = await page.$$eval('[data-testid="member-card"]', (els) =>
          els.map((card) => {
            const cats = [...card.querySelectorAll('[data-testid="member-other"]')].map((o) => o.dataset.category)
            const note = card.querySelector('[data-testid="member-ht05-note"]')
            const box = note?.getBoundingClientRect()
            const cardBox = card.getBoundingClientRect()
            return {
              expected: cats.includes('over25') && cats.includes('sh05'),
              note: !!note,
              mark: !!card.querySelector('[data-testid="member-ht05-note-mark"]'),
              text: note?.textContent ?? null,
              inside: !box || (box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5 && box.right <= window.innerWidth + 0.5 && note.scrollWidth <= note.clientWidth + 1),
              lines: box ? Math.round(box.height / parseFloat(getComputedStyle(note).lineHeight)) : 0,
            }
          }),
        )
        const size = await overflow(page)
        if (size.scroll > size.inner) ht05.overflow.push(`${day}/${width}: sayfa ${size.scroll} > ${size.inner}`)
        cards.forEach((c, i) => {
          if (width === 390) {
            ht05.cards++
            if (c.note) ht05.withNote++
          }
          if (c.note !== c.expected || c.mark !== c.expected || (c.note && c.text !== "* İlk yarı gol olmazsa devre arasında 1.5 ÜST'e yönelebilirsiniz.")) ht05.wrong.push(`${day}/${width}/#${i + 1}`)
          if (!c.inside) ht05.overflow.push(`${day}/${width}/#${i + 1}`)
          if (c.note) ht05.lines.add(`${width}px:${c.lines}`)
        })
      }
    }
  }
  step('İY 0.5 ÜST (*) notu yalnızca koşulda (diğer önerilerde 2.5 ÜST ve 2. YARI 0.5 ÜST) ve metin aynen', ht05.wrong.length === 0 && ht05.cards > 0, ht05.wrong.join(' ') || `${ht05.withNote}/${ht05.cards} İY kartında not`)
  step('İY 0.5 ÜST (*) notu başka kategorinin kartında yok', ht05.elsewhere.length === 0, ht05.elsewhere.join(' '))
  step('İY 0.5 ÜST (*) notu 360 ve 390 px taşma yok', ht05.overflow.length === 0, ht05.overflow.join(' ') || `satır sayısı: ${[...ht05.lines].sort().join(', ') || '—'}`)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await tap('member-day-0')
  if ((await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))).includes('member-category-ht05')) {
    await tap('member-category-ht05')
    await page.evaluate(() => document.querySelector('[data-testid="member-ht05-note"]')?.scrollIntoView({ block: 'center' }))
    for (const width of [360, 390]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 2 })
      await new Promise((r) => setTimeout(r, 150))
      await page.screenshot({ path: join(shots, `iy05-not-${width}.png`) })
      report.ekranlar.push({ dosya: `iy05-not-${width}.png`, genislik: width, tasma: 'ölçüldü' })
    }
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  }
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
  // Günün öne çıkanları: seçimi olan günde kutu var, olmayan günde hiç yok
  await page.click(sel('member-day-0'))
  await sleep(150)
  step('öne çıkanlar: seçimi olmayan günde kutu hiç görünmüyor', (await page.$(sel('member-highlights'))) === null)
  await page.click(sel('member-day-1'))
  await page.waitForSelector(sel('member-highlights'))
  const highlightBox = await page.$eval(sel('member-highlights'), (el) => ({
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    rows: [...el.querySelectorAll('[data-testid="member-highlight"]')].map((row) => row.innerText.replace(/\s+/g, ' ').trim()),
    trial: el.querySelector('[data-testid="member-highlights-trial"]')?.textContent.trim(),
    note: el.querySelector('[data-testid="member-highlights-note"]')?.textContent.trim(),
    aboveCategories: el.getBoundingClientRect().bottom <= document.querySelector('[data-testid^="member-category-"]').getBoundingClientRect().top,
    belowTitle: el.getBoundingClientRect().top >= document.querySelector('[data-testid="member-day-title"]').getBoundingClientRect().bottom,
  }))
  step('öne çıkanlar: seçim sayısı kadar satır (saat, maç, kategori)', highlightBox.rows.length === 3 && highlightBox.rows.every((row) => /^\d{2}:\d{2} ?.+ – .+/.test(row)), highlightBox.rows[0])
  step('öne çıkanlar: skor ve Tuttu / Tutmadı görünüyor', highlightBox.rows.every((row) => /MS \d/.test(row) && /✓ Tuttu|✗ Tutmadı|— Değerlendirilemedi/.test(row)), highlightBox.rows.map((row) => row.split(' ').slice(-2).join(' ')).join(' | '))
  step('öne çıkanlar: başlıkta "deneme" notu, altta yasal not; kutuda yüzde ve güvenilirlik yok', highlightBox.trial === 'deneme' && highlightBox.note === 'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir.' && !highlightBox.text.includes('%') && !/güvenilirlik/i.test(highlightBox.text))
  step('öne çıkanlar: gün başlığının altında, kategori düğmelerinin üstünde', highlightBox.aboveCategories && highlightBox.belowTitle)
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
    const size = await overflow(page)
    const inside = await page.$eval(sel('member-highlights'), (el) => el.getBoundingClientRect().right <= window.innerWidth && el.scrollWidth <= el.clientWidth)
    step(`öne çıkanlar ${width} px: taşma yok`, size.scroll <= size.inner && inside, `${size.scroll} / ${size.inner}`)
  }
  await cardShot(page, 'member-highlights', 'one-cikanlar')
  await shot(page, 'analiz-dun-sonuclar', 390)
  const outcomes = await page.$$eval(sel('member-outcome'), (els) => [...new Set(els.map((el) => el.textContent.trim()))])
  step('önceki günde sonuç işaretleri görünüyor', outcomes.some((o) => o.startsWith('✓')) && outcomes.some((o) => o.startsWith('✗')), outcomes.join(' | '))

  // 4b) Sıralama: "Yüzdeye göre | Saate göre" (yalnızca bellekte; numara yüzde sırasıdır)
  const sortState = () =>
    page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`)
      const meta = q('member-list-meta').getBoundingClientRect()
      const group = q('member-sort')
      const box = group.getBoundingClientRect()
      return {
        pressed: [...group.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.testid),
        role: group.getAttribute('role'),
        label: group.getAttribute('aria-label'),
        live: q('member-sort-live')?.getAttribute('aria-live') ?? null,
        announce: q('member-sort-live')?.textContent.trim() ?? null,
        note: q('member-sort-note')?.textContent.trim() ?? null,
        sameRow: group.parentElement === q('member-list-meta').parentElement,
        // Geçiş, meta yazısının yanında ya da (dar ekranda) altında; kategori şeridinin altında ve ekranda
        placed: (box.top >= meta.bottom - 1 || box.left >= meta.right - 1) && box.top >= document.querySelector('[data-testid^="member-category-"]').getBoundingClientRect().bottom && box.left >= 0 && box.right <= window.innerWidth + 0.5,
        buttons: [...group.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)),
        cards: [...document.querySelectorAll('[data-testid="member-card"]')].map((card) => {
          const spans = [...card.firstElementChild.children]
          return { rank: Number(spans[0].textContent), time: /^\d{2}:\d{2}$/.test(spans[1]?.textContent ?? '') ? spans[1].textContent : null, match: card.querySelector('h3').textContent.trim(), note: card.querySelector('[data-testid="member-market-note"]') !== null }
        }),
      }
    })
  /** Saat modunda beklenen diziliş: saat artan, saati olmayan sona, eşit saatte numara artan */
  const timeOrdered = (cards) =>
    cards.every((c, i) => {
      if (i === 0) return true
      const p = cards[i - 1]
      if (p.time === null) return c.time === null && c.rank > p.rank
      if (c.time === null) return true
      return p.time < c.time || (p.time === c.time && p.rank < c.rank)
    })
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const sortDefault = await sortState()
  step('sıralama: varsayılan "Yüzdeye göre"; role=group, aria-pressed, aria-live; not ve duyuru yok', JSON.stringify(sortDefault.pressed) === '["member-sort-percent"]' && sortDefault.role === 'group' && sortDefault.label === 'Sıralama' && sortDefault.live === 'polite' && sortDefault.announce === '' && sortDefault.note === null && sortDefault.sameRow && sortDefault.placed, JSON.stringify({ ...sortDefault, cards: sortDefault.cards.length }))
  step('sıralama: yüzde modunda numara 1, 2, 3…', sortDefault.cards.every((c, i) => c.rank === i + 1))
  // Saat modunun dizilişi değiştirdiği bir liste seç (bugün); bulunamazsa ilk liste.
  let sortChip = null
  for (const chip of await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))) {
    await tap(chip)
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(chip))
    const { cards } = await sortState()
    if (!timeOrdered(cards) && cards.some((c) => c.time !== null) && (await page.$(sel('member-market-toggle'))) !== null) {
      sortChip = chip
      break
    }
  }
  sortChip ??= (await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid)))[0]
  await tap(sortChip)
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(sortChip))
  // Bir kartın "Açıklama" notunu aç: diziliş değişince aynı kartta açık kalmalı (React anahtarı aynı).
  const noteCard = await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="member-market-toggle"]')
    if (!toggle) return null
    toggle.click()
    return Number(toggle.closest('[data-testid="member-card"]').firstElementChild.firstElementChild.textContent)
  })
  const beforeTime = await sortState()
  await tap('member-sort-time')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, sel('member-sort-time'))
  const byTime = await sortState()
  const sameCards = JSON.stringify([...byTime.cards].sort((a, b) => a.rank - b.rank).map(({ rank, match, time }) => [rank, match, time])) === JSON.stringify(beforeTime.cards.map(({ rank, match, time }) => [rank, match, time]))
  step('sıralama: "Saate göre" saat artan, saati olmayan sonda, eşit saatte numara artan; numara ve maç eşleşmesi değişmez', timeOrdered(byTime.cards) && sameCards && byTime.cards.map((c) => c.rank).join() !== beforeTime.cards.map((c) => c.rank).join(), `${sortChip.replace('member-category-', '')}: ${byTime.cards.map((c) => `${c.rank}@${c.time ?? '—'}`).join(' ')}`)
  step('sıralama: saat modunda not ve ekran okuyucu duyurusu', byTime.note === 'Numara, yüzde sırasını gösterir.' && byTime.announce === 'Saate göre sıralandı' && JSON.stringify(byTime.pressed) === '["member-sort-time"]', `${byTime.note} · ${byTime.announce}`)
  step('sıralama: açık "Açıklama" notu aynı kartta açık kalıyor', noteCard !== null && byTime.cards.filter((c) => c.note).map((c) => c.rank).join() === String(noteCard), `kart ${noteCard}`)
  await page.evaluate(() => document.querySelector('[data-testid="member-market-toggle"][aria-expanded="true"]')?.click())
  const sortStore = await session(page)
  step('sıralama: tarayıcı deposuna yazılmıyor (yalnızca bellekte)', Object.keys(sortStore.session).join() === 'gollazim.uye.oturum' && Object.keys(sortStore.local).length === 0, JSON.stringify(Object.keys(sortStore.session)))
  const sortLeak = FORBIDDEN.exec(await visibleText(page)) ?? /bahis|kazan|tahmin|öner|fırsat|değer|#/.exec(`${byTime.note} ${byTime.announce} ${byTime.label} ${await text(page, 'member-sort')}`.toLocaleLowerCase('tr'))
  step('sıralama: saat modunda sayfada ve yeni metinlerde yasak terim yok', sortLeak === null, sortLeak?.[0] ?? '')
  for (const width of [320, 360, 390]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await sleep(150)
    const size = await overflow(page)
    const st = await sortState()
    step(`sıralama: ${width} px taşma yok; geçiş ekranda, düğmeler tam`, size.scroll <= size.inner && st.placed && st.buttons.every((h) => h >= 28), `${size.scroll} / ${size.inner} · düğme ${st.buttons.join('/')} px`)
    await page.evaluate(() => (document.querySelector('header').style.position = 'static'))
    const top = await page.$eval(sel('member-day-title'), (el) => el.getBoundingClientRect().top + window.scrollY)
    const bottom = await page.$eval(sel('member-cards'), (el) => Math.min(el.getBoundingClientRect().top + window.scrollY + 420, document.documentElement.scrollHeight))
    await page.screenshot({ path: join(shots, `siralama-saat-${width}.png`), clip: { x: 0, y: top, width, height: bottom - top } })
    await page.evaluate(() => (document.querySelector('header').style.position = ''))
    report.ekranlar.push({ dosya: `siralama-saat-${width}.png`, genislik: width, tasma: size.scroll > size.inner ? `${size.scroll} > ${size.inner}` : 'yok' })
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  // Gün ve kategori değişince seçim korunur.
  const keepsTime = async () => JSON.stringify((await sortState()).pressed) === '["member-sort-time"]' && timeOrdered((await sortState()).cards)
  await tap('member-day-1')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel('member-day-1'))
  const keptDay = await keepsTime()
  const otherChip = (await page.$$eval('[data-testid^="member-category-"]', (els) => els.map((el) => el.dataset.testid))).find((c) => c !== sortChip)
  await tap(otherChip)
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel(otherChip))
  const keptChip = await keepsTime()
  await tap('member-day-0')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-selected') === 'true', {}, sel('member-day-0'))
  step('sıralama: gün ve kategori değişince "Saate göre" korunuyor', keptDay && keptChip && (await keepsTime()))
  // Klavye: Enter ile "Yüzdeye göre"ye dön; paketteki sıra geri gelir.
  await page.focus(sel('member-sort-percent'))
  await page.keyboard.press('Enter')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, sel('member-sort-percent'))
  const backPercent = await sortState()
  step('sıralama: klavyeyle "Yüzdeye göre"ye dönülüyor; numara 1, 2, 3…, not kalkıyor', backPercent.cards.every((c, i) => c.rank === i + 1) && backPercent.note === null && backPercent.announce === 'Yüzdeye göre sıralandı')
  await shot(page, 'siralama-yuzde', 320)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  // İstatistik ve Seri Takibi sekmesine gidip dönünce korunduğu aşağıda denenir.
  await tap('member-sort-time')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, sel('member-sort-time'))
  await page.evaluate(() => window.scrollTo(0, 0))

  // 5) İstatistik
  await page.click(`a[href="${T.stats}"]`)
  await page.waitForSelector(sel('member-overall'))
  const all = await text(page, 'member-overall')
  const topAll = await page.evaluate(() => document.body.innerText)
  const allLine = await page.$(sel('member-all-line'))
  const scopeNote = await text(page, 'member-main-scope-note')
  step('istatistik: en üstte "ANA KATEGORİLER BAŞARISI" ve üç kategori', topAll.includes('ANA KATEGORİLER BAŞARISI') && topAll.includes('2.5 ÜST · KG VAR · İLK YARI 0.5 ÜST') && !topAll.includes('GENEL BAŞARI'))
  await cardShot(page, 'member-top-card', 'istatistik-ust-kart-tumu')
  step('istatistik: "Tüm kategoriler" satırı yok; bölümlerin üç kategoriyi kapsadığı yazıyor', allLine === null && scopeNote === "Bu bölümler yalnızca 2.5 ÜST, KG VAR ve İLK YARI 0.5 ÜST'ü kapsar; diğer kategoriler yalnızca Kategori bazlı başarı'da gösterilir.", scopeNote)
  await page.click(sel('member-scope-shared'))
  const shared = await text(page, 'member-overall')
  step('istatistik: Tümü / Paylaşılan geçişi', all !== shared, `Tümü ${all} · Paylaşılan ${shared}`)
  await cardShot(page, 'member-top-card', 'istatistik-ust-kart-paylasilan')
  step('istatistik: Paylaşılan ölçüsünde de "Tüm kategoriler" satırı yok', (await page.$(sel('member-all-line'))) === null)
  await page.click(sel('member-scope-all'))
  for (const period of ['weekly', 'monthly', 'daily']) await page.click(sel(`member-period-${period}`))
  const statLeak = FORBIDDEN.exec(await visibleText(page))
  step('istatistikte yasak terim yok (canlı sayfa)', statLeak === null, statLeak?.[0] ?? '')
  // Sürüm 14: eski "İY 0.5 ÜST TUTMADIĞINDA 2. YARI" kutusu yok; yerine yalnızca (*) notlu maçların kutusu.
  // n < 20 iken yüzde yok ("az veri"), k/n görünür; 360 ve 390 px'te kutu ve sayfa taşmaz.
  const ht05Box = { problems: [], texts: [] }
  for (const scope of ['all', 'shared']) {
    await page.click(sel(`member-scope-${scope}`))
    await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, sel(`member-scope-${scope}`))
    for (const width of [360, 390]) {
      await page.setViewport({ width, height: 844, deviceScaleFactor: 1 })
      await new Promise((r) => setTimeout(r, 150))
      const box = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="member-ht05-card"]')
        if (!card) return null
        const r = card.getBoundingClientRect()
        const n = /İlk yarısı 0-0 biten (\d+) maç/.exec(card.innerText)
        return { text: card.innerText.replace(/\s+/g, ' '), n: n ? Number(n[1]) : 0, inside: r.left >= 0 && r.right <= window.innerWidth + 0.5 && card.scrollWidth <= card.clientWidth + 1, old: !!document.querySelector('[data-testid="member-ht-card"]') }
      })
      const size = await overflow(page)
      if (!box) { ht05Box.problems.push(`${scope}/${width}: kutu yok`); continue }
      if (box.old) ht05Box.problems.push(`${scope}/${width}: eski kutu var`)
      if (!box.inside || size.scroll > size.inner) ht05Box.problems.push(`${scope}/${width}: taşma`)
      if (box.n === 0 && !box.text.includes('Henüz maç yok.')) ht05Box.problems.push(`${scope}/${width}: N=0 metni yok`)
      if (box.n > 0 && box.n < 20 && (/%\d/.test(box.text) || !box.text.includes('az veri'))) ht05Box.problems.push(`${scope}/${width}: n<20 iken yüzde var ya da "az veri" yok`)
      if (!box.text.includes('Geçmiş maçların sayımıdır; ölçümdür, tavsiye değildir.') || !box.text.includes("kartta not 26 Ekim 2026'dan itibaren görünüyor")) ht05Box.problems.push(`${scope}/${width}: açıklama metni eksik`)
      if (width === 390) ht05Box.texts.push(`${scope}: ${box.text.replace(/^.*?İlk yarısı/, 'İlk yarısı').slice(0, 110)}`)
    }
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.click(sel('member-scope-all'))
  step('istatistik: eski İY kutusu yok; (*) kutusu Tümü ve Paylaşılan, n<20 yüzde yok, 360/390 px taşma yok', ht05Box.problems.length === 0, ht05Box.problems.join(' ') || ht05Box.texts.join(' ‖ '))
  await cardShot(page, 'member-ht05-card', 'istatistik-iy05-kutu')
  step('istatistik 390 px taşma yok', await shot(page, 'istatistik', 390))
  step('istatistik 320 px taşma yok', await shot(page, 'istatistik', 320))
  await page.click(`a[href="${T.home}"]`)
  await page.waitForSelector(sel('member-cards'))
  step('sıralama: İstatistik sekmesinden dönünce "Saate göre" korunuyor', await keepsTime())

  // 5b) Seri takibi (paket sürümü 8)
  await page.click(`a[href="${T.streak}"]`)
  await page.waitForSelector(sel('member-streak'))
  const streak = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`)
    const number = (id) => q(id).textContent.trim()
    return {
      heading: q('member-streak').querySelector('h1').innerText.replace(/\s+/g, ' ').trim(),
      trial: q('member-streak-trial').textContent.trim(),
      note: q('member-streak-note').textContent.trim(),
      totals: { longest: number('member-streak-longest'), current: number('member-streak-current'), count: number('member-streak-count'), mean: number('member-streak-mean'), won: number('member-streak-won'), lost: number('member-streak-lost') },
      labels: [...q('member-streak-totals').querySelectorAll('p:first-child')].map((p) => p.textContent.trim()),
      lowSample: q('member-streak-low-sample')?.textContent.trim() ?? null,
      steps: [...document.querySelectorAll('[data-testid="member-streak-step"]')].map((li) => ({ state: li.dataset.state, text: li.innerText.replace(/\s+/g, ' ').trim() })),
      runs: [...document.querySelectorAll('[data-testid="member-streak-run"]')].map((li) => ({ length: Number(li.dataset.length), text: li.textContent.replace(/\s+/g, ' ').trim() })),
      text: q('member-streak').innerText,
      tabActive: document.querySelector('a[aria-current="page"]')?.textContent.trim(),
    }
  })
  step('seri takibi: sekme açıldı; başlık "Seri Takibi" ve yanında "deneme" notu', streak.heading === 'Seri Takibi deneme' && streak.trial === 'deneme' && streak.tabActive === 'SERİ TAKİBİ', `${streak.heading} · sekme ${streak.tabActive}`)
  step('seri takibi: altı sayı kutusu (en uzun, mevcut, toplam, seri başına tutan (ort.), tuttu, tutmadı)', JSON.stringify(streak.labels) === JSON.stringify(['En uzun seri', 'Mevcut seri', 'Toplam seri', 'Seri başına tutan (ort.)', 'Tuttu', 'Tutmadı']) && Object.values(streak.totals).every((v) => /^(\d+|\d+,\d|—)$/.test(v)), JSON.stringify(streak.totals))
  const stepsWon = streak.steps.filter((s) => s.state === 'won').length
  step('seri takibi: sayılar listeyle tutarlı (8 sentetik adım: tuttu + tutmadı = 8; mevcut seri = aktif serideki tutan adım; tutmadı = toplam seri)', Number(streak.totals.won) + Number(streak.totals.lost) === 8 && Number(streak.totals.current) === stepsWon && streak.totals.lost === streak.totals.count && streak.runs.length === Number(streak.totals.count) && Math.max(stepsWon, ...streak.runs.map((r) => r.length)) === Number(streak.totals.longest), `aktif ${streak.steps.length} adım · geçmiş ${streak.runs.map((r) => r.length).join(',') || '-'}`)
  step('seri takibi: adım satırı maç, kategori, gün, saat, adım numarası ve durum', streak.steps.every((s) => /^.+ – .+ .+ · \d{1,2} \S+ \d{4} \d{2}:\d{2}( · .+)? \d+\. adım ✓ Tuttu$/.test(s.text)) && streak.runs.every((r) => r.text.startsWith(`${r.length} adım tuttu`) && r.text.includes('Seriyi bitiren maç:')), streak.steps[0]?.text ?? streak.runs[0]?.text ?? '')
  step('seri takibi: az örnek uyarısı ve yasal not', streak.lowSample?.startsWith('⚠ az örnek') && streak.note === 'İstatistik takibidir, bahis tavsiyesi değildir. 18+', streak.lowSample ?? '')
  const streakLeak = /%|[★☆]|(iy|ms) \d|oran|kasa|kupon|katla|rolling|kazanç|ortalama|güvenilirlik|geçmiş veri/.exec(streak.text.replace(streak.note, '').toLocaleLowerCase('tr'))
  step('seri takibi: yüzde, yıldız, skor, geçmiş veri ve yasak sözcük yok', streakLeak === null && FORBIDDEN.exec(await visibleText(page)) === null, streakLeak?.[0] ?? '')
  step('seri takibi 390 px taşma yok', await shot(page, 'seri', 390))
  step('seri takibi 320 px taşma yok', await shot(page, 'seri', 320))
  await page.click(`a[href="${T.home}"]`)
  await page.waitForSelector(sel('member-cards'))
  step('sıralama: Seri Takibi sekmesinden dönünce "Saate göre" korunuyor', await keepsTime())
  await page.click(`a[href="${T.streak}"]`)
  await page.waitForSelector(sel('member-streak'))
  await page.reload({ waitUntil: 'networkidle0' })
  step('seri takibi: sayfa yenilenince aynı sayfada kalıyor', (await page.$(sel('member-streak'))) !== null && (await page.evaluate(() => location.hash)) === T.streak)
  await page.click(`a[href="${T.home}"]`)
  await page.waitForSelector(sel('member-cards'))
  step('sıralama: sayfa yenilenince varsayılan "Yüzdeye göre"', JSON.stringify((await sortState()).pressed) === '["member-sort-percent"]')

  // 6) Üye oturumunda admin yolları
  if (T.prefix === '/gollazim-uye/') {
    // Ayrı üye sitesinde admin rotası yoktur: bilinmeyen her yol ve eski "#/uye" bağlantıları köke döner.
    const landed = []
    for (const hash of ['#/admin', '#/skor-girisi', '#/uye', '#/uye/istatistik', '#/olmayan-sayfa']) {
      await page.goto(`${site}${hash}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector(sel('member-frame'))
      await sleep(150)
      landed.push(`${hash}→${await page.evaluate(() => location.hash)}`)
    }
    step('ayrı üye sitesinde admin yolları ve eski "#/uye" bağlantıları köke yönleniyor', landed.every((l) => l.endsWith('→#/')) && (await page.$(sel('member-cards'))) !== null, landed.join('  '))
    const adminText = await page.evaluate(() => document.body.innerText)
    step('ayrı üye sitesinde admin gezinmesi ya da admin sayfası yok', !/ADMİN|SKOR GİRİŞİ|AI ANALİZİ|Veriyi dışa aktar/.test(adminText) && (await page.$('[data-testid="csv-input"]')) === null)
  }
  await page.goto(`${site}#/admin`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-frame'))
  step('üye oturumunda #/admin üye sayfasına yönleniyor', (await page.evaluate(() => location.hash)).startsWith(T.home) && !requests.some((u) => /AdminRoot-/.test(u)), await page.evaluate(() => location.hash))

  // 7) Yeni yayın: aynı oturumda şifre sorulmadan
  await page.waitForSelector(sel('member-sort-time'))
  await tap('member-sort-time')
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', {}, sel('member-sort-time'))
  packageFile = 'paket-2.json'
  await refreshNow(page)
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.trim() === 'Yayın no 2', { timeout: 15000 }, sel('member-publish-no'))
  step('yeni yayın oturum içinde, şifre sorulmadan açıldı', true, await text(page, 'member-publish-no'))
  step('sıralama: paket yenilenince "Saate göre" korunuyor', await keepsTime())

  // 8) Sayfa yenileme: oturum sürer
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-cards'))
  step('sayfa yenilenince oturum sürüyor; yasal uyarı penceresi çıkmıyor', (await page.$(sel('member-login'))) === null && (await page.$(sel('member-legal'))) === null)
  step('sıralama: sayfa yenilenince yine "Yüzdeye göre"', JSON.stringify((await sortState()).pressed) === '["member-sort-percent"]')

  // 9) Eski paket uyarısı
  packageFile = 'paket-eski.json'
  await refreshNow(page)
  await page.waitForSelector(sel('member-stale'), { timeout: 15000 })
  step('eski pakette "güncel olmayabilir" uyarısı', (await text(page, 'member-stale')).includes('Bu veri güncel olmayabilir.'), `${await text(page, 'member-updated')}`)
  await shot(page, 'eski-paket', 320)
  packageFile = 'paket-2.json'

  // 9b) Sürüm 7 paket (seri takibi alanı yok): yine açılır; sekme çıkmaz, adresi ana sayfaya döner
  packageFile = 'paket-v7.json'
  await refreshNow(page)
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.trim() === 'Yayın no 5', { timeout: 15000 }, sel('member-publish-no'))
  const v7Links = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')))
  step('sürüm 7 paket hâlâ açılıyor: kartlar çiziliyor, Seri Takibi sekmesi yok', (await page.$(sel('member-cards'))) !== null && JSON.stringify(v7Links) === JSON.stringify([T.home, T.stats]) && (await page.$(sel('member-refresh-error'))) === null, JSON.stringify(v7Links))
  await page.goto(`${site}${T.streak}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-frame'))
  await sleep(200)
  step('sürüm 7 pakette seri adresi ana sayfaya dönüyor', (await page.evaluate(() => location.hash)) === T.home && (await page.$(sel('member-streak'))) === null, await page.evaluate(() => location.hash))
  packageFile = 'paket-2.json'
  await refreshNow(page)
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.trim() === 'Yayın no 2', { timeout: 15000 }, sel('member-publish-no'))
  step('ardından sürüm 8 paket yeniden açılıyor; Seri Takibi sekmesi geri geliyor', (await page.$(sel('member-tab-streak'))) !== null)

  // 10) Sekmeyi kapatıp yeni sekme açınca oturum biter
  await page.close()
  const second = await browser.newPage()
  watch(second)
  await second.setViewport({ width: 390, height: 844 })
  await second.goto(`${site}${T.home}`, { waitUntil: 'networkidle0' })
  await second.waitForSelector(sel('member-login'))
  step('sekme kapatılıp yeni sekme açılınca giriş istiyor; yasal uyarı penceresi yeniden çıkıyor', Object.keys((await session(second)).session).length === 0 && (await second.$(sel('member-legal'))) !== null)

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
  const dataPaths = [...new Set(paths.filter((p) => !p.startsWith(T.prefix)))]
  step(`istekler yalnızca ${T.prefix} ve paket adresine gitti`, JSON.stringify(dataPaths) === '["/gollazim-yayin/paket.json"]', dataPaths.join(' ') + ` · ${new Set(paths).size} ayrı adres`)
  step('uygulamanın geri kalanı (AdminRoot) hiç indirilmedi', !requests.some((u) => /AdminRoot-/.test(u)))
  const stores = await second.evaluate(async () => ({ db: (await indexedDB.databases()).map((d) => d.name), local: Object.keys(localStorage), cookie: document.cookie }))
  step('deneme boyunca veritabanı açılmadı, localStorage ve çerez boş', stores.db.length === 0 && stores.local.length === 0 && stores.cookie === '', JSON.stringify(stores))

  if (T.prefix === '/gollazim-uye/') {
    // 15) Aynı alan adındaki admin verisi: admin sitesinde veri dolu bir profilde üye sitesini kullanmak hiçbir şeyi değiştirmez
    const dump = (p) =>
      p.evaluate(
        () =>
          new Promise((done) => {
            const open = indexedDB.open('gollazim')
            open.onsuccess = async () => {
              const db = open.result
              const out = { surum: db.version }
              for (const name of [...db.objectStoreNames].sort()) {
                const store = db.transaction(name).objectStore(name)
                const [keys, values] = await Promise.all([new Promise((r) => (store.getAllKeys().onsuccess = (e) => r(e.target.result))), new Promise((r) => (store.getAll().onsuccess = (e) => r(e.target.result)))])
                out[name] = JSON.stringify(keys.map((k, i) => [k, values[i]]))
              }
              db.close()
              done({ json: JSON.stringify(out), local: JSON.stringify({ ...localStorage }) })
            }
          }),
      )
    const adminPage = await browser.newPage()
    adminPage.on('dialog', (d) => void d.accept())
    await adminPage.setViewport({ width: 1280, height: 900 })
    // Yedek VERİ-YEDEK sekmesinden yüklenir (gizli sekmenin metni ekran metnine girmez).
    await adminPage.goto(`${origin}/gollazim-site/#/admin?sekme=veri`, { waitUntil: 'networkidle0' })
    await (await adminPage.$('input[type=file][accept="application/json,.json"]:not([data-testid])')).uploadFile(backupFile)
    await adminPage.waitForFunction(() => document.body.innerText.includes('Yedek yüklendi'), { timeout: 30000 })
    await adminPage.goto(`${origin}/gollazim-site/#/`, { waitUntil: 'networkidle0' })
    await sleep(400)
    const before = await dump(adminPage)
    // Aynı profilde üye sitesi: giriş, gezinme, istatistik, çıkış
    packageFile = 'paket.json'
    const memberPage = await browser.newPage()
    await memberPage.setViewport({ width: 390, height: 844 })
    await memberPage.goto(`${site}${T.home}`, { waitUntil: 'networkidle0' })
    await signIn(memberPage, login.username, login.password)
    await memberPage.waitForSelector(sel('member-cards'), { timeout: 30000 })
    await memberPage.click(sel('member-day-1'))
    await memberPage.click(`a[href="${T.stats}"]`)
    await memberPage.waitForSelector(sel('member-overall'))
    const during = await dump(memberPage)
    await memberPage.click(sel('member-logout'))
    await memberPage.waitForSelector(sel('member-login'))
    const after = await dump(adminPage)
    const tables = Object.keys(JSON.parse(before.json)).length - 1
    step('admin verisi dolu profilde üye sitesi kullanıldı: veritabanı dökümü önce / sırasında / sonra bayt bayt aynı', before.json === during.json && before.json === after.json && tables === 19, `${tables} tablo · sürüm ${JSON.parse(before.json).surum} · sha256 ${sha(before.json).slice(0, 16)}`)
    step('admin sitesinin localStorage kayıtları da değişmedi', before.local === during.local && before.local === after.local, before.local)
    await adminPage.reload({ waitUntil: 'networkidle0' })
    step('üye sitesinden sonra admin sitesi aynı profilde normal açılıyor', (await adminPage.evaluate(() => document.body.innerText)).includes('GÜNÜN ANALİZLERİ') && (await adminPage.evaluate(() => location.hash)) === '#/')
  }

  if (T.prefix === '/gollazim-site/') {
  // 15) Uygulamanın geri kalanı: üye oturumu olmayan sekmede eskisi gibi açılır
  const admin = await browser.newPage()
  await admin.setViewport({ width: 1280, height: 900 })
  await admin.goto(`${site}#/admin`, { waitUntil: 'networkidle0' })
  await admin.waitForSelector('[data-testid="csv-input"]', { timeout: 15000 })
  const menu = await admin.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()))
  step('üye oturumu yokken #/admin eskisi gibi açılıyor; menüde üye sayfası yok', menu.includes('ADMİN') && menu.includes('SKOR GİRİŞİ') && !menu.some((m) => /ÜYE/.test(m)), `${menu.length} menü öğesi`)
  await admin.goto(`${site}#/`, { waitUntil: 'networkidle0' })
  step('ana sayfa açılıyor', (await admin.evaluate(() => document.body.innerText)).includes('GÜNÜN ANALİZLERİ'))
  }
} catch (error) {
  failed = true
  step('beklenmeyen hata', false, String(error?.message ?? error))
} finally {
  await browser.close()
  rmSync(profile, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(reportDir, T.rapor), JSON.stringify(report, null, 1) + '\n')
console.log(`${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · ${report.tarayici} · rapor: ${join(reportDir, T.rapor)}`)
return { failed, shots, steps: report.adimlar.length }
}

let anyFailed = false
const results = {}
try {
  for (const name of targetNames) {
    results[name] = await runTarget(TARGETS[name])
    anyFailed ||= results[name].failed
  }
  // İki hedef aynı paketlerle denendiyse ekran görüntüleri bayt bayt aynı olmalı:
  // aynı uygulama, aynı stil. Fark, üye derlemesinde eksik stil sınıfı demektir.
  if (results.eski && results.yeni) {
    const names = readdirSync(results.eski.shots).filter((f) => f.endsWith('.png')).sort()
    const other = readdirSync(results.yeni.shots).filter((f) => f.endsWith('.png')).sort()
    const different = names.filter((f) => !other.includes(f) || sha(readFileSync(join(results.eski.shots, f))) !== sha(readFileSync(join(results.yeni.shots, f))))
    const ok = different.length === 0 && names.length === other.length && names.length > 0
    console.log(`\n${ok ? '✓' : '✗'} ekran görüntüsü karşılaştırması (eski rota ↔ ayrı üye sitesi): ${names.length - different.length}/${names.length} görüntü bayt bayt aynı${different.length ? ` · FARKLI: ${different.join(', ')}` : ''}`)
    writeFileSync(join(reportDir, 'ekran-karsilastirma.json'), JSON.stringify({ toplam: names.length, ayni: names.length - different.length, farkli: different }, null, 1) + '\n')
    anyFailed ||= !ok
  }
} finally {
  server.close()
  // Test kullanıcısının şifresi ve paketler burada biter.
  rmSync(sampleDir, { recursive: true, force: true })
}
process.exit(anyFailed ? 1 : 0)
