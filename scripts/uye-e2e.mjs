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

if (!process.env.UYE_BACKUP || !existsSync(resolve(process.env.UYE_BACKUP))) {
  console.error('UYE_BACKUP (JSON yedek) verilmeli.')
  process.exit(1)
}
const reportDir = resolve(process.env.UYE_ORNEK ?? 'samples/uye')
/** Paketlerin ve test kullanıcısının üretildiği geçici klasör; deneme bitince silinir */
const sampleDir = mkdtempSync(join(tmpdir(), 'gollazim-uye-ornek-'))

/** Geçici klasörde şifreli örnek paket (ve ilk çağrıda sentetik test kullanıcısı) üretir */
function generate(dir, env = {}) {
  execFileSync('npx', ['vitest', 'run', 'src/services/member/sample'], { env: { ...process.env, UYE_ORNEK: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
}
generate(sampleDir, { UYE_N: '1' })
generate(sampleDir, { UYE_N: '2', UYE_DOSYA: 'paket-2.json' })
generate(sampleDir, { UYE_N: '3', UYE_DOSYA: 'paket-cikarilmis.json', UYE_CIKAR: '1' })
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
  eski: { ad: 'admin sitesindeki üye rotası', prefix: '/gollazim-site/', home: '#/uye', stats: '#/uye/istatistik', shots: 'ekran', rapor: 'e2e-rapor.json', dist },
  yeni: { ad: 'ayrı üye sitesi', prefix: '/gollazim-uye/', home: '#/', stats: '#/istatistik', shots: 'ekran-uye-sitesi', rapor: 'uye-sitesi-e2e-rapor.json', dist: memberDist },
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
  step('düzende yalnızca iki sekme var', JSON.stringify(navLinks) === JSON.stringify([T.home, T.stats]), JSON.stringify(navLinks))

  // 4) Kartlar, gün ve kategori seçimi
  const cardCount = await page.$$eval(sel('member-card'), (els) => els.length)
  step('kategori listesi çizildi', cardCount > 0, `${cardCount} kart`)
  const labels = await page.$$eval(sel('member-percent-label'), (els) => [...new Set(els.map((el) => el.textContent.trim()))])
  step('büyük yüzdenin altında sabit etiket var', labels.length === 1 && labels[0] === 'Geçmiş maçlarda görülme sıklığı' && (await page.$$eval(sel('member-percent-label'), (els) => els.length)) === cardCount, labels.join(' | '))
  step('kartların üstünde açıklama satırı', (await text(page, 'member-percent-note')).startsWith('Yüzdeler geçmiş verilere ve model hesaplarına dayanan özetlerdir;'), await text(page, 'member-percent-note'))
  // %100 + Düşük güvenilirlik: yüzde sönük ve küçük, rozet belirgin (gerçek veride bu kartlar var)
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
  step('%100 + Düşük: yüzde daha küçük ve sönük, güvenilirlik rozeti daha büyük ve kalın', !!dim && !!normal && dim.text === '%100' && dim.badge.includes('Düşük') && dim.size < normal.size && dim.color !== normal.color && dim.badgeSize > normal.badgeSize && Number(dim.badgeWeight) > Number(normal.badgeWeight), dim && normal ? `sönük ${dim.size}px ${dim.color} · olağan ${normal.size}px ${normal.color} · rozet ${dim.badgeSize}px/${dim.badgeWeight} ↔ ${normal.badgeSize}px/${normal.badgeWeight} · ${styles.soluk.length} sönük, ${styles.olagan.length} olağan kart` : 'bu kategoride örnek yok')
  step('sönük gösterim yalnızca %100 + Düşük kartlarda', styles.soluk.every((c) => c.text === '%100' && c.badge.includes('Düşük')) && styles.olagan.every((c) => !(c.text === '%100' && c.badge.includes('Düşük'))))
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
      // Satırdaki yüzdeler: %100 + Düşük olanlar vurgusuz (soluk), diğerleri yarı kalın ve beyaz
      percents: [...document.querySelectorAll('[data-testid="member-other"]')].map((el) => {
        const percent = [...el.querySelectorAll('span')].find((span) => span.textContent.trim().startsWith('%'))
        return { dim: el.dataset.overstated === 'true', text: percent.textContent.trim(), weight: Number(getComputedStyle(percent).fontWeight), color: getComputedStyle(percent).color }
      }),
    }
  })
  step('"Aynı maçın diğer önerileri" satırı var; küçük ve soluk', others.withRow > 0 && others.sample.startsWith('Aynı maçın diğer önerileri:') && others.rowSize <= 11 && others.rowSize < others.bigSize / 2, `${others.withRow}/${others.cards} kartta · ${others.rowSize}px ${others.rowColor} · "${others.sample.slice(0, 90)}"`)
  const dimOthers = others.percents.filter((p) => p.dim)
  const plainOthers = others.percents.filter((p) => !p.dim)
  step('satırdaki %100 + Düşük yüzdeler de sönük; diğerleri vurgulu', dimOthers.length > 0 && plainOthers.length > 0 && dimOthers.every((p) => p.text === '%100' && p.weight < 500 && p.color === others.rowColor) && plainOthers.every((p) => p.weight >= 600 && p.color !== others.rowColor), `${dimOthers.length} sönük, ${plainOthers.length} vurgulu`)
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
  for (const day of [0, 1]) {
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
  await page.click(`a[href="${T.stats}"]`)
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
  await second.goto(`${site}${T.home}`, { waitUntil: 'networkidle0' })
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
    await adminPage.goto(`${origin}/gollazim-site/#/admin`, { waitUntil: 'networkidle0' })
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
    step('admin verisi dolu profilde üye sitesi kullanıldı: veritabanı dökümü önce / sırasında / sonra bayt bayt aynı', before.json === during.json && before.json === after.json && tables === 14, `${tables} tablo · sürüm ${JSON.parse(before.json).surum} · sha256 ${sha(before.json).slice(0, 16)}`)
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
