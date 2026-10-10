// Geliştirme aracı: Admin'deki üye yönetimi, "Yayınla" ve üye anahtar yedeğini DERLENMİŞ
// sitede, gerçek tarayıcıda uçtan uca dener; ayrıca uygulamanın tüm sayfaları için duman
// testi yapar (konsol hatası yok, CSV yükleme çalışıyor).
//
//   npm run build && UYE_BACKUP=samples/gollazim-yedek-….json UYE_CSV=samples/….csv npm run uye:admin-e2e
//
// Tarayıcı iki ayrı, geçici profille açılır (ikincisi "profil sıfırlandı" denemesidir);
// kullanıcının tarayıcı verisine dokunulmaz. İndirilen paketler, anahtar yedeği ve test
// üyelerinin şifreleri GEÇİCİ bir klasörde tutulur ve deneme bitince silinir.
// Çıktı (kimlik içermez): UYE_ORNEK/ekran/admin-*.png ve UYE_ORNEK/admin-e2e-rapor.json
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const sampleDir = resolve(process.env.UYE_ORNEK ?? 'samples/uye')
const backupFile = resolve(process.env.UYE_BACKUP ?? '')
const csvFile = resolve(process.env.UYE_CSV ?? '')
if (!process.env.UYE_BACKUP || !existsSync(backupFile) || !process.env.UYE_CSV || !existsSync(csvFile)) {
  console.error('UYE_BACKUP (JSON yedek) ve UYE_CSV (örnek CSV) verilmeli.')
  process.exit(1)
}
const dist = resolve('dist')
const memberDist = resolve('dist-uye')
/** İndirilenlerin tutulduğu geçici klasör; deneme bitince silinir */
const outDir = mkdtempSync(join(tmpdir(), 'gollazim-admin-e2e-'))
const shots = join(sampleDir, 'ekran')
mkdirSync(shots, { recursive: true })
const puppeteer = createRequire(join(resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107')), 'x.js'))('puppeteer-core')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json' }
/** /gollazim-yayin/paket.json adresinde sunulan dosya */
let published = null
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  let file = null
  if (path === '/gollazim-yayin/paket.json') file = published
  else if (path.startsWith('/gollazim-site/')) {
    file = normalize(join(dist, path.slice('/gollazim-site/'.length) || 'index.html'))
    if (!file.startsWith(dist)) file = null
  } else if (path.startsWith('/gollazim-uye/')) {
    // Ayrı üye sitesi (varsa): Admin'in "Yayınla" ekranı sürüm bilgisini buradan okur.
    file = normalize(join(memberDist, path.slice('/gollazim-uye/'.length) || 'index.html'))
    if (!file.startsWith(memberDist)) file = null
  }
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('Not Found')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const site = `${origin}/gollazim-site/`

const report = { adimlar: [], duman: [], ekranlar: [], konsolHatalari: [] }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail && { ayrinti: String(detail) }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sel = (id) => `[data-testid="${id}"]`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const GENERIC = 'Kullanıcı adı veya şifre hatalı.'
const PASSWORD = /^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/

/** Yeni, geçici profilli tarayıcı ve indirme klasörü */
async function openBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'gollazim-admin-'))
  const downloads = mkdtempSync(join(tmpdir(), 'gollazim-indirme-'))
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const cdp = await page.target().createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  page.on('dialog', (dialog) => void dialog.accept())
  page.on('pageerror', (error) => report.konsolHatalari.push(`${page.url().split('#')[1] ?? ''}: ${error.message}`))
  page.on('console', (message) => message.type() === 'error' && report.konsolHatalari.push(`${page.url().split('#')[1] ?? ''}: ${message.text()}`))
  /** İndirme klasörüne düşen (tamamlanmış) tek dosyayı bekler, hedefe taşır */
  const takeDownload = async (target) => {
    for (let i = 0; i < 100; i++) {
      const files = readdirSync(downloads).filter((f) => !f.endsWith('.crdownload'))
      if (files.length > 0) {
        await sleep(150)
        const name = files[0]
        copyFileSync(join(downloads, name), target)
        for (const f of readdirSync(downloads)) rmSync(join(downloads, f))
        return name
      }
      await sleep(100)
    }
    throw new Error('indirme gelmedi')
  }
  const close = async () => {
    await browser.close()
    rmSync(profile, { recursive: true, force: true })
    rmSync(downloads, { recursive: true, force: true })
  }
  return { browser, page, takeDownload, close }
}

const go = async (page, hash) => {
  await page.goto(`${site}#${hash}`, { waitUntil: 'networkidle0' })
  await sleep(250)
}
const text = (page, id) => page.$eval(sel(id), (el) => el.textContent.replace(/\s+/g, ' ').trim())
/** Öğeye tıklar. Sayfa uzun ve üst menü yapışkan olduğundan fare yerine DOM tıklaması kullanılır. */
const tap = (page, id) => page.$eval(sel(id), (el) => el.click())
const bodyText = (page) => page.evaluate(() => document.body.innerText)
/** Alanı boşaltıp değeri yazar (React'in izlediği input olayıyla) */
const setValue = async (page, id, value) => {
  await page.$eval(sel(id), (el) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (value) await page.type(sel(id), value)
}
async function restoreMainBackup(page) {
  const input = await page.$('input[type=file][accept="application/json,.json"]:not([data-testid])')
  await input.uploadFile(backupFile)
  await page.waitForFunction(() => document.body.innerText.includes('Yedek yüklendi'), { timeout: 20000 })
}
async function shot(page, id, name) {
  const element = await page.$(sel(id))
  // Yapışkan üst menü görüntünün üstüne binmesin diye çekim sırasında sabitlenir.
  await page.evaluate(() => (document.querySelector('header').style.position = 'static'))
  await element.screenshot({ path: join(shots, `${name}.png`) })
  await page.evaluate(() => (document.querySelector('header').style.position = ''))
  report.ekranlar.push(`${name}.png`)
}
/** Üye sayfasında (yeni sekmede) giriş dener: 'ok:<yayın no>', 'hata:<metin>' */
async function memberLogin(browser, username, password) {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${site}#/uye`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('member-username'))
  // Yasal uyarı penceresi: giriş formu ancak kabulden sonra kullanılabilir.
  if (await page.$(sel('member-legal'))) await page.$eval(sel('member-legal-accept'), (el) => el.click())
  await page.type(sel('member-username'), username)
  await page.type(sel('member-password'), password)
  await page.keyboard.press('Enter')
  await page.waitForSelector(`${sel('member-cards')}, ${sel('member-error')}`, { timeout: 30000 })
  // Öne çıkanlar kutusu (varsa): satır sayısı ve kutuda yüzde işareti geçip geçmediği
  const highlights = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="member-highlights"]')
    return box ? `${box.querySelectorAll('[data-testid="member-highlight"]').length}:${box.innerText.includes('%') ? 'yüzde-var' : 'yüzde-yok'}:${box.innerText.includes('deneme') ? 'deneme' : 'not-yok'}` : 'yok'
  })
  // Seri takibi sayfası: aktif adım + geçmiş seri sayısı, "deneme" notu ve sayfada yüzde geçip geçmediği
  let streak = 'yok'
  if (await page.$(sel('member-tab-streak'))) {
    await page.$eval(sel('member-tab-streak'), (el) => el.click())
    await page.waitForSelector(sel('member-streak'))
    streak = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="member-streak"]')
      return `${box.querySelectorAll('[data-testid="member-streak-step"]').length + box.querySelectorAll('[data-testid="member-streak-run"]').length}:${box.innerText.includes('%') ? 'yüzde-var' : 'yüzde-yok'}:${box.innerText.includes('deneme') ? 'deneme' : 'not-yok'}`
    })
  }
  const result = (await page.$(sel('member-cards'))) || streak !== 'yok' ? `ok:${await text(page, 'member-publish-no')}|${await text(page, 'member-disclaimer')}|seri=${streak}|öne-çıkan=${highlights}` : `hata:${await text(page, 'member-error')}`
  await page.close()
  return result
}
const dumpDatabase = (page) =>
  page.evaluate(
    () =>
      new Promise((done, fail) => {
        const open = indexedDB.open('gollazim')
        open.onerror = () => fail(open.error)
        open.onsuccess = async () => {
          const db = open.result
          const out = {}
          for (const name of [...db.objectStoreNames]) out[name] = await new Promise((r) => (db.transaction(name).objectStore(name).getAll().onsuccess = (e) => r(e.target.result)))
          db.close()
          done(JSON.stringify(out))
        }
      }),
  )

const PAGES = [
  ['/', 'GÜNÜN ANALİZLERİ'],
  ['/kategori/2-5-ust', '2.5 ÜST'],
  ['/kategori/kg-var', 'KG VAR'],
  ['/bol-gol', 'BOL GOL'],
  ['/korner', 'KORNER'],
  ['/kart', 'KART'],
  ['/taraf-gol', 'TARAF & GOL'],
  ['/ai-analizi', 'AI ANALİZİ'],
  ['/skor-girisi', 'SKOR GİRİŞİ'],
  ['/istatistik', 'İSTATİSTİK'],
  ['/admin', 'ADMİN'],
]
async function smoke(page, label) {
  for (const [hash, title] of PAGES) {
    const before = report.konsolHatalari.length
    await go(page, hash)
    const heading = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => '')
    const errors = report.konsolHatalari.length - before
    const ok = heading.toLocaleUpperCase('tr').includes(title) && errors === 0
    report.duman.push({ durum: label, sayfa: hash, baslik: heading, konsolHatasi: errors, sonuc: ok ? 'TAMAM' : 'HATA' })
    if (!ok) step(`duman testi (${label}) ${hash}`, false, `başlık "${heading}", ${errors} konsol hatası`)
  }
  step(`duman testi (${label}): ${PAGES.length} sayfa açıldı, konsol hatası yok`, report.duman.filter((d) => d.durum === label).every((d) => d.sonuc === 'TAMAM'))
}

const passwords = {}
let failed = false
let first = null
let second = null
try {
  // ───────── 1. profil ─────────
  first = await openBrowser()
  const { page, browser, takeDownload } = first

  // A) ADMİN DUMAN TESTİ
  await smoke(page, 'boş')
  await go(page, '/admin')
  await (await page.$(sel('csv-input'))).uploadFile(csvFile)
  await page.waitForFunction(() => /maç (eklendi|yüklendi)|eklendi|güncellendi/i.test(document.body.innerText), { timeout: 20000 })
  const uploadText = (await bodyText(page)).split('\n').find((l) => /eklendi|güncellendi/.test(l)) ?? ''
  step('örnek CSV yüklendi', true, uploadText.slice(0, 90))
  await smoke(page, 'CSV yüklü')
  await go(page, '/')
  const rows = await page.$$eval('main li', (els) => els.length)
  step('ana sayfada öneri satırları var', rows > 0, `${rows} satır`)
  await go(page, '/kategori/iy-0-5-ust')
  const cards = await page.$$eval('main article', (els) => els.length)
  step('kategori sayfasında maç kartları var', cards > 0, `${cards} kart`)
  await page.click(sel('score-odds-toggle')).catch(() => undefined)
  await go(page, '/skor-girisi')
  step('skor girişinde maç formları var', (await page.$$eval(sel('score-form'), (els) => els.length)) > 0)
  await go(page, '/admin')
  const exportButton = (await page.$x("//button[contains(., 'Veriyi dışa aktar')]"))[0]
  await exportButton.click()
  const exported = join(outDir, 'duman-yedek.json')
  const exportedName = await takeDownload(exported)
  const exportedBackup = JSON.parse(readFileSync(exported, 'utf8'))
  step('yedek indirildi ve geçerli', exportedBackup.app === 'gollazim' && exportedBackup.version === 1 && exportedBackup.matches.length > 0, `${exportedName}: ${exportedBackup.matches.length} maç`)
  step('normal yedekte üye alanı yok', !/member|uye|publication|kek/i.test(Object.keys(exportedBackup).join(',')), Object.keys(exportedBackup).length + ' alan')
  rmSync(exported)
  await restoreMainBackup(page)
  step('yedek geri yüklendi', true)
  await go(page, '/istatistik')
  await page.waitForSelector(sel('overall-rate'), { timeout: 15000 })
  step('istatistik sayfası dolu', true, await text(page, 'overall-rate'))
  // En üstteki kart yalnızca ana kategorileri, altındaki satır tüm kategorileri gösterir (iki ölçüde de).
  const topCard = async () => ({ card: await text(page, 'main-card'), main: Number(await text(page, 'main-decided')), all: Number(await text(page, 'overall-decided')), line: await text(page, 'overall-line') })
  const topAll = await topCard()
  step('istatistik: "ANA KATEGORİLER BAŞARISI" kartı üç kategoriyi sayıyor', topAll.card.startsWith('ANA KATEGORİLER BAŞARISI2.5 ÜST · KG VAR · İLK YARI 0.5 ÜST') && topAll.main > 0 && topAll.main < topAll.all, `${await text(page, 'main-rate')} · ${topAll.main} öneri`)
  step('istatistik: "Tüm kategoriler" satırı eski genel değeri gösteriyor', /^Tüm kategoriler: %[\d,]+ · \d+ öneri · \d+ benzersiz maç$/.test(topAll.line), topAll.line)
  await tap(page, 'stats-scope-shared')
  await sleep(200)
  const topShared = await topCard()
  step('istatistik: Paylaşılan ölçüsünde iki değer de değişiyor', topShared.main <= topAll.main && topShared.all < topAll.all && topShared.main <= topShared.all, `${await text(page, 'main-rate')} · ${topShared.main} öneri — ${topShared.line}`)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await shot(page, 'main-card', 'admin-istatistik-ana-kategoriler-paylasilan')
  await tap(page, 'stats-scope-all')
  await sleep(200)
  await shot(page, 'main-card', 'admin-istatistik-ana-kategoriler')
  await page.setViewport({ width: 1280, height: 900 })
  await smoke(page, 'yedek yüklü')

  // B) ÜYE YÖNETİMİ
  await go(page, '/admin')
  await page.waitForSelector(sel('member-admin-members'))
  step('boşken: üye yok, yayın uyarısı var, hatırlatıcı yok', (await page.$(sel('member-list-empty'))) !== null && (await page.$(sel('publish-no-members'))) !== null && (await page.$(sel('member-key-reminder'))) === null)
  await shot(page, 'member-admin-publish', 'admin-yayinla-uye-yok')
  // Ayrı üye sitesinin sürümü: aynı alan adındaki surum.json okunur ve bu sürümle karşılaştırılır.
  await page.waitForSelector(sel('publish-site-version'), { timeout: 10000 })
  const siteVersion = { level: await page.$eval(sel('publish-site-version'), (el) => el.dataset.level), text: await text(page, 'publish-site-version') }
  const localVersion = existsSync(join(memberDist, 'surum.json')) ? JSON.parse(readFileSync(join(memberDist, 'surum.json'), 'utf8')) : null
  step('Yayınla ekranı üye sitesinin sürümünü gösteriyor', localVersion ? siteVersion.level === 'ok' && siteVersion.text === `Üye sitesi güncel (${localVersion.commit}).` : siteVersion.level === 'unknown', `${siteVersion.level}: ${siteVersion.text}`)

  await setValue(page, 'member-add-username', 'şule')
  const formatProblem = await text(page, 'member-add-problem')
  step('Türkçe karakterli ad reddedilir', formatProblem.includes('Türkçe harf') && (await page.$eval(sel('member-add'), (el) => el.disabled)), formatProblem.slice(0, 60))
  await setValue(page, 'member-add-username', 'Ali')
  await tap(page, 'member-add')
  await page.waitForSelector(sel('member-issued-ali'), { timeout: 20000 })
  passwords.ali = await page.$eval(`${sel('member-issued-ali')} ${sel('member-issued-password')}`, (el) => el.textContent.trim())
  step('üye eklendi: şifre bir kez gösterildi, biçimi doğru', PASSWORD.test(passwords.ali))
  await tap(page, 'member-issued-close')
  step('kutu kapanınca şifre ekranda yok', !(await bodyText(page)).includes(passwords.ali))
  await setValue(page, 'member-add-username', ' ALI ')
  step('aynı ad reddedilir', (await text(page, 'member-add-problem')).includes('zaten var'))
  await setValue(page, 'member-add-username', '')

  await page.type(sel('member-bulk-input'), 'veli\nzeynep\nali\nİsmail\n')
  const preview = await text(page, 'member-bulk-preview')
  step('toplu ekleme önizlemesi', preview.startsWith('2 geçerli ad') && preview.includes('2 satır alınmayacak'), preview.slice(0, 110))
  await tap(page, 'member-bulk-add')
  await page.waitForSelector(sel('member-distribution-download'), { timeout: 30000 })
  for (const name of ['veli', 'zeynep']) passwords[name] = await page.$eval(`${sel(`member-issued-${name}`)} ${sel('member-issued-password')}`, (el) => el.textContent.trim())
  step('toplu ekleme: 2 üye, şifreler farklı', PASSWORD.test(passwords.veli) && PASSWORD.test(passwords.zeynep) && passwords.veli !== passwords.zeynep)
  await shot(page, 'member-issued', 'admin-sifreler-bir-kez')
  await tap(page, 'member-distribution-download')
  const csvPath = join(outDir, 'dagitim.csv')
  const csvName = await takeDownload(csvPath)
  const csv = readFileSync(csvPath, 'utf8')
  rmSync(csvPath) // şifre içerir: okunur okunmaz silinir
  step('dağıtım listesi indirildi (kullanıcı adı;şifre)', /^gollazim-uye-dagitim-\d{4}-\d{2}-\d{2}\.csv$/.test(csvName) && csv === `kullanici_adi;sifre\r\nveli;${passwords.veli}\r\nzeynep;${passwords.zeynep}\r\n`, csvName)
  step('dağıtım listesi bir kez indirilir', await page.$eval(sel('member-distribution-download'), (el) => el.disabled))
  const issuedText = await text(page, 'member-issued')
  step('ekranda büyük uyarılar', issuedText.includes('ŞİFRELER YALNIZCA ŞİMDİ GÖRÜNÜR') && issuedText.includes('BU DOSYA ŞİFRE İÇERİR'))
  await tap(page, 'member-issued-close')

  const listText = await text(page, 'member-list')
  const stored = await dumpDatabase(page)
  const leaked = Object.values(passwords).filter((p) => listText.includes(p) || stored.includes(p) || stored.includes(p.replace(/-/g, '')))
  step('üye listesi: 3 aktif; şifre ne ekranda ne veritabanında', (await page.$$eval('[data-testid^="member-row-"][data-active="true"]', (els) => els.length)) === 3 && leaked.length === 0)
  const memberRows = JSON.parse(stored).members
  step('veritabanında yalnızca türetilmiş anahtarlar', memberRows.length === 3 && memberRows.every((m) => Object.keys(m).sort().join() === 'active,createdAt,idKey,kek,username'), Object.keys(memberRows[0]).join(','))
  step('üye anahtar yedeği hatırlatıcısı: hiç yedek yok', (await page.$eval(sel('member-key-reminder'), (el) => el.dataset.level)) === 'never')
  await shot(page, 'member-key-reminder', 'admin-hatirlatici')
  await shot(page, 'member-admin-members', 'admin-uyeler')

  // C) METİNLER VE YAYIN
  await setValue(page, 'member-text-disclaimer', 'E2E özel uyarı metni. 18+')
  await tap(page, 'member-texts-save')
  await page.waitForSelector(sel('member-texts-saved'))
  await shot(page, 'member-texts-panel', 'admin-metinler')
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.includes('öneri'), {}, sel('publish-summary'))
  const summary = await text(page, 'publish-summary')
  const active = await text(page, 'publish-active-count')
  step('yayın özeti: aktif üye, maç ve öneri sayısı, boyut', active.startsWith('3 aktif üye') && /\d+ maç · \d+ öneri/.test(summary) && summary.includes('KB'), `${active} | ${summary.slice(0, 80)}`)
  const publishNow = async (name) => {
    await tap(page, 'publish-start')
    await tap(page, 'publish-confirm')
    await page.waitForSelector(sel('publish-result'), { timeout: 20000 })
    const target = join(outDir, name)
    const downloaded = await takeDownload(target)
    published = target
    return { downloaded, result: await text(page, 'publish-result') }
  }
  // Öne çıkan seçim: örnek maçlar geçmişte olduğu için düğmeyle eklenemez; kayıt doğrudan
  // veritabanına yazılır (yayın günü, saati olan bir maç). Yüzde ve güvenilirlik kayıtta VAR.
  const publishDay = await page.$eval(sel('publish-day'), (el) => el.value)
  const seeded = await page.evaluate(
    (day) =>
      new Promise((done, fail) => {
        const open = indexedDB.open('gollazim')
        open.onerror = () => fail(open.error)
        open.onsuccess = () => {
          const db = open.result
          db.transaction('matches').objectStore('matches').getAll().onsuccess = (e) => {
            const match = e.target.result.find((m) => m.date === day && m.time)
            const record = { id: `${day}|${match.id}|over25`, date: day, matchId: match.id, categoryId: 'over25', addedAt: new Date().toISOString(), home: match.home, away: match.away, time: match.time, percent: 87, reliability: 'low' }
            // Seri takibi adımı da aynı yolla yazılır (aynı maç, sıra 1).
            const tx = db.transaction(['highlights', 'streakSteps'], 'readwrite')
            tx.objectStore('highlights').put(record)
            tx.objectStore('streakSteps').put({ id: `${match.id}|over25`, matchId: match.id, categoryId: 'over25', seq: 1, addedAt: new Date().toISOString(), date: day, home: match.home, away: match.away, time: match.time })
            tx.oncomplete = () => {
              db.close()
              done(record)
            }
          }
        }
      }),
    publishDay,
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.includes('1 öne çıkan'), { timeout: 20000 }, sel('publish-summary'))
  step('yayın özeti: gün başına öne çıkan sayısı', (await text(page, 'publish-summary')).includes('1 öne çıkan'), `${publishDay}: ${seeded.home} – ${seeded.away}`)
  const streakSummary = await text(page, 'publish-summary-streak')
  step('yayın özeti: seri takibi satırı (1 adım)', /^Seri takibi: aktif seride [01] adım \([01] bekleyen\) · [01] geçmiş seri$/.test(streakSummary) && streakSummary !== 'Seri takibi: aktif seride 0 adım (0 bekleyen) · 0 geçmiş seri', streakSummary)
  step('admin: Seri Takibi panelinde adım görünüyor', (await page.$$eval(`${sel('streak-panel')} ${sel('streak-row')}`, (els) => els.length)) === 1 && (await text(page, 'streak-note')) === 'İstatistik takibidir, bahis tavsiyesi değildir. 18+')
  const order = await text(page, 'publish-order')
  step('yayın kartında sıra notu: önce uye-yayinla, sonra yayinla', order.indexOf('npm run uye-yayinla') > 0 && order.indexOf('npm run uye-yayinla') < order.indexOf('npm run yayinla'), order.slice(0, 90))
  await tap(page, 'publish-start')
  const confirmText = await text(page, 'publish-highlights')
  step('yayın onayı: "bu yayında N öne çıkan var, yayından sonra kaldırılamaz"', confirmText === 'Bu yayında 1 öne çıkan var; yayından sonra kaldırılamaz.' && !(await page.$eval(sel('publish-confirm'), (el) => el.disabled)), confirmText)
  await page.$$eval('[data-testid="publish-confirm-box"] button', (els) => els[els.length - 1].click())
  const p1 = await publishNow('paket-1.json')
  const afterPublish = await page.evaluate(
    (id) =>
      new Promise((done) => {
        const open = indexedDB.open('gollazim')
        open.onsuccess = () => {
          const db = open.result
          db.transaction('highlights').objectStore('highlights').get(id).onsuccess = (e) => {
            db.close()
            done(e.target.result)
          }
        }
      }),
    seeded.id,
  )
  step('yayından sonra seçim "yayınlandı" olarak işaretlendi', typeof afterPublish?.publishedAt === 'string' && afterPublish.percent === 87, afterPublish?.publishedAt)
  step('yayın 1: paket.json indirildi, "sızıntı denetimi geçti"', p1.downloaded === 'paket.json' && p1.result.includes('Sızıntı denetimi geçti') && p1.result.includes('Yayın no 1 · 3 üye'), p1.result.slice(0, 110))
  await shot(page, 'member-admin-publish', 'admin-yayinla')
  const envelope = JSON.parse(readFileSync(join(outDir, 'paket-1.json'), 'utf8'))
  const openPart = JSON.stringify({ ...envelope, ciphertext: '', slots: [] })
  step('indirilen paket şifreli: açık kısımda içerik, kullanıcı adı yok; 64 yuva', envelope.format === 'gollazim-uye-paket' && envelope.slots.length === 64 && !/ali|veli|zeynep|percent|home|highlights/.test(openPart) && !readFileSync(join(outDir, 'paket-1.json'), 'utf8').includes('Cerezo'))
  for (const name of ['ali', 'veli', 'zeynep']) {
    const result = await memberLogin(browser, name, passwords[name])
    step(`üye girişi (yayın 1): ${name}`, result.startsWith('ok:Yayın no 1') && result.includes('E2E özel uyarı metni. 18+'), result.slice(0, 60))
    step(`üye sayfası (yayın 1): Seri Takibi sekmesinde 1 kayıt, "deneme" notu var, yüzde yok: ${name}`, result.includes('|seri=1:yüzde-yok:deneme|'), result.split('|').slice(-2)[0])
    step(`üye sayfası (yayın 1): öne çıkanlar kutusunda 1 satır, "deneme" notu var, yüzde yok: ${name}`, result.endsWith('öne-çıkan=1:yüzde-yok:deneme'), result.split('|').pop())
  }

  // D) ÇIKAR + YENİDEN YAYINLA
  await tap(page, 'member-remove-republish-veli')
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.includes('Yayın no 2'), { timeout: 20000 }, sel('publish-result'))
  published = join(outDir, 'paket-2.json')
  await takeDownload(published)
  step('çıkar ve yeniden yayınla: yayın 2, 2 üye', (await text(page, 'publish-result')).includes('Yayın no 2 · 2 üye') && (await page.$eval(sel('member-row-veli'), (el) => el.dataset.active)) === 'false')
  const removedLogin = await memberLogin(browser, 'veli', passwords.veli)
  step('çıkarılan üye giremiyor (genel hata)', removedLogin === `hata:${GENERIC}`, removedLogin)
  step('kalan üye yeni yayını açıyor', (await memberLogin(browser, 'ali', passwords.ali)).startsWith('ok:Yayın no 2'))
  step('çıkarılan üyede işlem düğmesi yok (yeniden etkinleştirme yok)', (await page.$(sel('member-renew-veli'))) === null && (await page.$(sel('member-remove-veli'))) === null)

  // E) ŞİFRE YENİLEME
  const oldZeynep = passwords.zeynep
  await tap(page, 'member-renew-zeynep')
  await page.waitForSelector(sel('member-renew-note'), { timeout: 20000 })
  passwords.zeynep = await page.$eval(`${sel('member-issued-zeynep')} ${sel('member-issued-password')}`, (el) => el.textContent.trim())
  step('şifre yenilendi: yeni şifre bir kez gösterildi, yeniden yayın önerildi', PASSWORD.test(passwords.zeynep) && passwords.zeynep !== oldZeynep)
  await tap(page, 'member-republish-now')
  await page.waitForFunction((s) => document.querySelector(s)?.textContent.includes('Yayın no 3'), { timeout: 20000 }, sel('publish-result'))
  published = join(outDir, 'paket-3.json')
  await takeDownload(published)
  await tap(page, 'member-issued-close')
  const oldLogin = await memberLogin(browser, 'zeynep', oldZeynep)
  step('eski şifre yeni yayında çalışmıyor', oldLogin === `hata:${GENERIC}`, oldLogin)
  step('yeni şifre çalışıyor', (await memberLogin(browser, 'zeynep', passwords.zeynep)).startsWith('ok:Yayın no 3'))
  const history = await page.$$eval(`${sel('publish-history')} tbody tr`, (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ')))
  step('yayın geçmişi: 3 satır, yeniden eskiye', history.length === 3 && history[0].startsWith('3') && history[2].startsWith('1'), history[0].slice(0, 50))

  // F) ÜYE ANAHTAR YEDEĞİ
  step('hatırlatıcı hâlâ "hiç yedek yok"', (await page.$eval(sel('keybackup-state'), (el) => el.dataset.level)) === 'never')
  await page.type(sel('keybackup-pass'), 'kisa')
  step('kısa parola engellenir', (await text(page, 'keybackup-pass-error')).includes('en az 12') && (await page.$eval(sel('keybackup-download'), (el) => el.disabled)))
  await setValue(page, 'keybackup-pass', 'aaaaaaaaaaaa')
  await setValue(page, 'keybackup-pass2', 'aaaaaaaaaaaa')
  step('zayıf parolada uyarı', (await page.$$eval(sel('keybackup-pass-warning'), (els) => els.length)) > 0)
  const PASS = 'e2e-mavi-kedi-73-masa'
  await setValue(page, 'keybackup-pass', PASS)
  await setValue(page, 'keybackup-pass2', `${PASS}x`)
  step('iki parola farklıysa engellenir', (await text(page, 'keybackup-pass-error')).includes('aynı değil'))
  await setValue(page, 'keybackup-pass2', PASS)
  await shot(page, 'member-admin-keybackup', 'admin-anahtar-yedegi')
  await tap(page, 'keybackup-download')
  await page.waitForSelector(sel('keybackup-status'), { timeout: 20000 })
  const keyFile = join(outDir, 'gollazim-uye-anahtar-e2e.json')
  const keyName = await takeDownload(keyFile)
  const keyText = readFileSync(keyFile, 'utf8')
  step('üye anahtar yedeği indirildi; içinde düz anahtar, ad ve parola yok', /^gollazim-uye-anahtar-\d{4}-\d{2}-\d{2}\.json$/.test(keyName) && JSON.parse(keyText).format === 'gollazim-uye-anahtar' && !memberRows.some((m) => keyText.includes(m.kek) || keyText.includes(m.idKey)) && !/ali|veli|zeynep/.test(JSON.stringify({ ...JSON.parse(keyText), ciphertext: '' })) && !keyText.includes(PASS), keyName)
  step('yedekten sonra hatırlatıcı kalktı', (await page.$(sel('member-key-reminder'))) === null && (await page.$eval(sel('keybackup-state'), (el) => el.dataset.level)) === 'ok')

  // G) NORMAL YEDEK ÜYE TABLOSUNU ETKİLEMEZ (gerçek IndexedDB)
  const membersBefore = JSON.parse(await dumpDatabase(page))
  await restoreMainBackup(page)
  await sleep(400)
  const membersAfter = JSON.parse(await dumpDatabase(page))
  step('normal yedeği geri yüklemek üye tablolarını silmedi/ezmedi', JSON.stringify(membersAfter.members) === JSON.stringify(membersBefore.members) && JSON.stringify(membersAfter.memberMeta) === JSON.stringify(membersBefore.memberMeta) && JSON.stringify(membersAfter.publications) === JSON.stringify(membersBefore.publications) && membersAfter.members.length === 3, `${membersAfter.members.length} üye, ${membersAfter.publications.length} yayın`)
  await page.setViewport({ width: 390, height: 844 })
  await sleep(200)
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  step('Admin sayfası 390 px taşma yok', size.scroll <= size.inner, `${size.scroll} / ${size.inner}`)
  await first.close()
  first = null

  // ───────── 2. profil: "profil sıfırlandı" ─────────
  second = await openBrowser()
  const fresh = second.page
  await go(fresh, '/admin')
  await restoreMainBackup(fresh)
  await fresh.waitForSelector(sel('member-admin-members'))
  step('yeni profilde üye yok', (await fresh.$(sel('member-list-empty'))) !== null)

  const tryRestore = async (file, passphrase) => {
    await (await fresh.$(sel('keybackup-file'))).uploadFile(file)
    await setValue(fresh, 'keybackup-restore-pass', passphrase)
    await tap(fresh, 'keybackup-restore')
    await fresh.waitForSelector(sel('keybackup-status'), { timeout: 20000 })
    return { kind: await fresh.$eval(sel('keybackup-status'), (el) => el.dataset.kind), text: await text(fresh, 'keybackup-status') }
  }
  const wrong = await tryRestore(keyFile, 'yanlis-parola-12345')
  step('yanlış parola net hatayla reddedildi', wrong.kind === 'error' && wrong.text.includes('Parola yanlış') && (await fresh.$(sel('member-list-empty'))) !== null, wrong.text)
  const brokenFile = join(outDir, 'bozuk-yedek.json')
  writeFileSync(brokenFile, keyText.slice(0, keyText.length - 40))
  const broken = await tryRestore(brokenFile, PASS)
  step('bozuk dosya net hatayla reddedildi', broken.kind === 'error' && broken.text.includes('üye anahtar yedeği değil ya da bozulmuş'), broken.text)
  const notBackup = await tryRestore(backupFile, PASS)
  step('normal yedek dosyası üye anahtar yedeği olarak kabul edilmez', notBackup.kind === 'error' && notBackup.text.includes('üye anahtar yedeği değil'))
  const good = await tryRestore(keyFile, PASS)
  step('yedek yüklendi: aynı aktif üyeler, aynı yayın numarası', good.kind === 'ok' && good.text.includes('2 aktif üye, son yayın no 3'), good.text)
  const restoredRows = await fresh.$$eval('[data-testid^="member-row-"]', (els) => els.map((el) => `${el.dataset.testid.replace('member-row-', '')}:${el.dataset.active}`))
  step('üye listesi yedektekiyle aynı', restoredRows.join() === 'ali:true,veli:false,zeynep:true', restoredRows.join())
  step('geri yüklemeden sonra hatırlatıcı yok', (await fresh.$(sel('member-key-reminder'))) === null)

  await fresh.waitForFunction((s) => document.querySelector(s)?.textContent.includes('öneri'), {}, sel('publish-summary'))
  step('sıradaki yayın no 4', (await text(fresh, 'publish-active-count')).includes('sıradaki yayın no 4'), await text(fresh, 'publish-active-count'))
  await tap(fresh, 'publish-start')
  await tap(fresh, 'publish-confirm')
  await fresh.waitForSelector(sel('publish-result'), { timeout: 20000 })
  published = join(outDir, 'paket-4.json')
  await second.takeDownload(published)
  step('yeni profilde yayın 4', (await text(fresh, 'publish-result')).includes('Yayın no 4 · 2 üye'))
  step('diğer üyeler yeni yayını açıyor: ali', (await memberLogin(second.browser, 'ali', passwords.ali)).startsWith('ok:Yayın no 4'))
  step('diğer üyeler yeni yayını açıyor: zeynep', (await memberLogin(second.browser, 'zeynep', passwords.zeynep)).startsWith('ok:Yayın no 4'))
  step('çıkarılan üye hâlâ giremiyor', (await memberLogin(second.browser, 'veli', passwords.veli)) === `hata:${GENERIC}`)

  // İndirilen son paket bir test üyesiyle çözülüp ham veriye karşı taranır (geçici dosyalarla).
  writeFileSync(join(outDir, 'giris.json'), JSON.stringify({ username: 'ali', password: passwords.ali }))
  let leak = ''
  try {
    execFileSync('npx', ['vitest', 'run', 'src/services/memberAdmin', '-t', 'indirilen paket'], { env: { ...process.env, UYE_E2E_PAKET: published, UYE_E2E_GIRIS: join(outDir, 'giris.json'), UYE_BACKUP: backupFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    leak = String(error.stdout ?? error.message).split('\n').filter((l) => /Assertion|expected|FAIL/.test(l)).slice(0, 2).join(' ') || 'denetim çalışmadı'
  }
  step('indirilen paketin düz hâlinde yasak terim ve ham alan yok', leak === '', leak)
  step('konsol hatası yok (tüm deneme boyunca)', report.konsolHatalari.length === 0, report.konsolHatalari.slice(0, 3).join(' | '))
} catch (error) {
  failed = true
  // Hata anında ekranda görünen hata metinleri de rapora yazılır.
  const active = second?.page ?? first?.page
  if (active) await active.screenshot({ path: join(shots, 'admin-hata.png'), fullPage: false }).catch(() => undefined)
  const shown = active ? await active.$$eval('[data-testid$="-error"], [data-testid="keybackup-status"]', (els) => els.map((el) => el.textContent.trim()).join(' | ')).catch(() => '') : ''
  step('beklenmeyen hata', false, `${error?.stack?.split('\n').slice(0, 2).join(' ') ?? String(error)}${shown ? ` · ekranda: ${shown}` : ''}`)
} finally {
  await first?.close().catch(() => undefined)
  await second?.close().catch(() => undefined)
  server.close()
  // Test üyelerinin şifreleri, paketler ve anahtar yedeği burada biter.
  rmSync(outDir, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(sampleDir, 'admin-e2e-rapor.json'), JSON.stringify(report, null, 1) + '\n')
console.log(`\n${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · rapor: ${join(sampleDir, 'admin-e2e-rapor.json')}`)
process.exit(failed ? 1 : 0)
