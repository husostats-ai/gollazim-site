// Geliştirme aracı: Admin sayfasının sekmelerini DERLENMİŞ sitede, gerçek tarayıcıda dener.
//
//   npm run build && ADMIN_CSV_DIR=<en az 4 CSV içeren klasör> node scripts/admin-sekme-e2e.mjs
//
// Denenenler: varsayılan sekme, sekme geçişi, adresteki ?sekme=…, yenilemede sekme, her bölümün
// tam bir sekmede olması, gizli sekmede durumun korunması (yapıştırma alanları, lig tablosu
// önizlemesi, AI cevap kutusu, bir kez gösterilen şifre), "yüklenen dosyalar" son 3 ve
// "yayın geçmişi" son 5 sınırı (veri silinmeden), sekme rozetleri, üstteki yayın durumu satırı
// ve yatay taşma (390, 360 ve 1280 px).
// Tarayıcı geçici bir profille açılır; kullanıcının tarayıcı verisine dokunulmaz. Test üyesinin
// şifresi ve indirilen paketler geçici klasörde kalır, deneme bitince silinir.
// Girdi (isteğe bağlı): ADMIN_LIG (yapıştırılacak lig tablosu metni; varsayılan samples/lig_tablosu_ornek.txt).
// Çıktı: ADMIN_SEKME_OUT (varsayılan samples/admin-sekme): ekran/*.png ve rapor.json
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const csvDir = resolve(process.env.ADMIN_CSV_DIR ?? '')
const csvFiles = process.env.ADMIN_CSV_DIR && existsSync(csvDir) ? readdirSync(csvDir).filter((f) => f.endsWith('.csv')).sort().slice(0, 4).map((f) => join(csvDir, f)) : []
if (csvFiles.length < 4) {
  console.error('ADMIN_CSV_DIR verilmeli ve içinde en az 4 CSV olmalı.')
  process.exit(1)
}
const leagueFile = resolve(process.env.ADMIN_LIG ?? 'samples/lig_tablosu_ornek.txt')
const leagueText = existsSync(leagueFile) ? readFileSync(leagueFile, 'utf8') : '1\tDeneme FC Stats\tDeneme FC\t5\t5\t0\t0\t13\t5\t+8\t15'
const dist = resolve('dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ yok: önce npm run build.')
  process.exit(1)
}
const outDir = resolve(process.env.ADMIN_SEKME_OUT ?? 'samples/admin-sekme')
const shots = join(outDir, 'ekran')
mkdirSync(shots, { recursive: true })
const puppeteer = createRequire(join(resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107')), 'x.js'))('puppeteer-core')

// Bölüm başlıkları ve sekmeleri (src/config/adminTabs.ts ile aynı olmalı; fark bu denemeyi düşürür).
const TABS = {
  gunluk: { label: 'GÜNLÜK', titles: ['CSV YÜKLE', 'LİG TABLOSU YAPIŞTIR', 'GÜNÜN ÖNE ÇIKANLARI', 'SERİ TAKİBİ', 'GÖRSEL OLUŞTUR'] },
  uyeler: { label: 'ÜYELER', titles: ['ÜYE SAYFASI: YAYINLA', 'ÜYE SAYFASI: ÜYELER', 'ÜYE SAYFASI: ÜYE ANAHTAR YEDEĞİ', 'AYARLAR: ÜYE SAYFASI METİNLERİ'] },
  ai: { label: 'AI ARAŞTIRMA', titles: ['HAM VERİ KARŞILAŞTIRMA'] },
  veri: { label: 'VERİ-YEDEK', titles: ['VERİ YEDEĞİ', 'MAÇLARI DÜZENLE', 'EŞİK DEĞERLERİ', 'AYARLAR: PİYASA ÇELİŞKİSİ SINIRI', 'AYARLAR: GÖRSEL VE AÇIKLAMA METİNLERİ'] },
}
const TAB_IDS = Object.keys(TABS)

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }
/** Üye sitesinin açabildiği paket sürümü; 1 yapılınca Admin "paketi açamaz" der */
let memberSitePayload = 99
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/gollazim-uye/surum.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(`{"commit":"0000000","payloadVersion":${memberSitePayload}}\n`)
  }
  const file = path.startsWith('/gollazim-site/') ? normalize(join(dist, path.slice('/gollazim-site/'.length) || 'index.html')) : null
  if (!file || !file.startsWith(dist) || !existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const site = `http://127.0.0.1:${server.address().port}/gollazim-site/`
const profile = mkdtempSync(join(tmpdir(), 'gollazim-sekme-'))
const downloads = mkdtempSync(join(tmpdir(), 'gollazim-indirme-'))

const report = { adimlar: [], sekmeCubugu: [], ekranlar: [], konsolHatalari: [] }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail !== '' && { ayrinti: String(detail) }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ` — ${detail}` : ''}`)
}
const sel = (id) => `[data-testid="${id}"]`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })
let failed = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  const cdp = await page.target().createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  page.on('dialog', (dialog) => void dialog.accept())
  page.on('pageerror', (error) => report.konsolHatalari.push(error.message))
  page.on('console', (message) => message.type() === 'error' && report.konsolHatalari.push(message.text()))

  const go = async (hash) => {
    await page.goto(`${site}#${hash}`, { waitUntil: 'networkidle0' })
    await sleep(250)
  }
  const tap = (id) => page.$eval(sel(id), (el) => el.click())
  const text = (id) => page.$eval(sel(id), (el) => el.textContent.replace(/\s+/g, ' ').trim())
  const value = (id) => page.$eval(sel(id), (el) => el.value)
  const hash = () => page.evaluate(() => location.hash)
  /** Alana değeri React'in izlediği input olayıyla yazar */
  const setValue = (id, next) =>
    page.$eval(
      sel(id),
      (el, v) => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      },
      next,
    )
  const openTab = async (id) => {
    await tap(`admin-tab-${id}`)
    await page.waitForSelector(`${sel(`admin-panel-${id}`)}:not([hidden])`)
    await sleep(120)
  }
  /** Sekmelerin ekrandaki durumu: seçili sekmeler ve gerçekten görünen (display ≠ none) paneller */
  const tabState = () =>
    page.evaluate(
      (ids) => ({
        selected: ids.filter((id) => document.querySelector(`[data-testid="admin-tab-${id}"]`).getAttribute('aria-selected') === 'true'),
        visible: ids.filter((id) => getComputedStyle(document.querySelector(`[data-testid="admin-panel-${id}"]`)).display !== 'none'),
        displays: ids.map((id) => getComputedStyle(document.querySelector(`[data-testid="admin-panel-${id}"]`)).display).join(','),
      }),
      TAB_IDS,
    )
  const onlyTab = (state, id) => state.selected.join() === id && state.visible.join() === id
  const count = (store) =>
    page.evaluate(
      (name) =>
        new Promise((done, fail) => {
          const open = indexedDB.open('gollazim')
          open.onerror = () => fail(open.error)
          open.onsuccess = () => {
            const db = open.result
            db.transaction(name).objectStore(name).count().onsuccess = (e) => {
              db.close()
              done(e.target.result)
            }
          }
        }),
      store,
    )
  const clearDownloads = () => {
    for (const f of readdirSync(downloads)) rmSync(join(downloads, f), { force: true })
  }
  const overflow = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  let viewport = { width: 390, height: 844, isMobile: true, hasTouch: true }
  /** Ekranı ayarlar. mobile: telefon gibi (kaydırma çubuğu yer kaplamaz, genişlik tam); değilse dar masaüstü penceresi. */
  const setScreen = async (width, height, mobile) => {
    viewport = { width, height, isMobile: mobile, hasTouch: mobile }
    // Telefon / masaüstü değişiminde tarayıcı sayfayı yeniden yükler; sekme çubuğu beklenir.
    await page.setViewport(viewport)
    await page.waitForSelector(sel('admin-tabs'))
    await page.waitForSelector(sel('member-admin-members'))
    await sleep(400)
  }
  /** Sayfanın tamamının görüntüsü: çekim için ekran sayfa boyuna uzatılır. */
  const shot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0))
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewport({ ...viewport, height: Math.max(viewport.height, height) })
    await sleep(200)
    await page.screenshot({ path: join(shots, `${name}.png`) })
    await page.setViewport(viewport)
    await sleep(200)
    report.ekranlar.push(join(shots, `${name}.png`))
  }

  // ───────── 1) Varsayılan sekme, geçiş, adres ─────────
  await go('/admin')
  await page.waitForSelector(sel('admin-tabs'))
  const initial = await tabState()
  step('varsayılan sekme GÜNLÜK; diğer üç panel gizli', onlyTab(initial, 'gunluk'), initial.displays)
  step('gizli panelde hidden, "grid" sınıfına rağmen display:none (Chrome 107); açık panel grid', initial.displays === 'grid,none,none,none', initial.displays)
  const labels = await page.$$eval(`${sel('admin-tabs')} [role=tab]`, (els) => els.map((el) => el.textContent.trim()))
  step('dört sekme: GÜNLÜK / ÜYELER / AI ARAŞTIRMA / VERİ-YEDEK', labels.join(' / ') === TAB_IDS.map((id) => TABS[id].label).join(' / '), labels.join(' / '))
  for (const id of ['uyeler', 'ai', 'veri', 'gunluk']) {
    await openTab(id)
    const state = await tabState()
    const wanted = id === 'gunluk' ? '#/admin' : `#/admin?sekme=${id}`
    step(`sekme geçişi: ${TABS[id].label} → yalnızca o panel görünür, adres ${wanted}`, onlyTab(state, id) && (await hash()) === wanted, `${state.displays} · ${await hash()}`)
  }
  const menuActive = async () => page.$$eval('nav a', (as) => as.filter((a) => a.className.includes('bg-brand')).map((a) => a.textContent.trim()).join())
  await openTab('uyeler')
  step('sekme açıkken üst menüde ADMİN aktif kalıyor (HashRouter ile çakışma yok)', (await menuActive()) === 'ADMİN', await menuActive())
  const historyBefore = await page.evaluate(() => history.length)
  await openTab('ai')
  await openTab('veri')
  step('sekme değişimi tarayıcı geçmişine kayıt eklemiyor (geri tuşu sekmelerde dolaşmaz)', (await page.evaluate(() => history.length)) === historyBefore, `${historyBefore}`)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector(sel('admin-tabs'))
  step('yenilemede aynı sekme (VERİ-YEDEK) açılıyor', onlyTab(await tabState(), 'veri') && (await hash()) === '#/admin?sekme=veri', await hash())
  for (const bad of ['olmayan', '', 'UYELER']) {
    await go(`/admin?sekme=${bad}`)
    await page.waitForSelector(sel('admin-tabs'))
    step(`bilinmeyen/boş parametre (?sekme=${bad}) → GÜNLÜK`, onlyTab(await tabState(), 'gunluk'))
  }
  for (const id of ['uyeler', 'ai']) {
    await go(`/admin?sekme=${id}`)
    await page.waitForSelector(sel('admin-tabs'))
    step(`doğrudan adres ?sekme=${id} → ${TABS[id].label}`, onlyTab(await tabState(), id))
  }
  step('tarayıcı depolamasına sekme kaydı yazılmadı', (await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).search(/sekme|tab/i) === -1)

  // ───────── 2) Yüklenen dosyalar: son 3 ─────────
  await go('/admin')
  for (let i = 0; i < csvFiles.length; i++) {
    await (await page.$(sel('csv-input'))).uploadFile(csvFiles[i])
    for (let t = 0; t < 150 && (await count('uploads')) < i + 1; t++) await sleep(100)
    await sleep(300)
  }
  const total = await count('uploads')
  step(`${csvFiles.length} CSV yüklendi (veritabanında ${total} yükleme kaydı)`, total === csvFiles.length, `${total}`)
  await page.waitForSelector(sel('upload-list-toggle'))
  const closed = { rows: (await page.$$(sel('upload-row'))).length, toggle: await text('upload-list-toggle') }
  step('yüklenen dosyalar: yalnızca son 3 kayıt görünür, "Tümünü göster (N)" var', closed.rows === 3 && closed.toggle === `Tümünü göster (${total})`, `${closed.rows} satır · ${closed.toggle}`)
  const newest = await page.$$eval(`${sel('upload-row')} p:first-child`, (els) => els.map((el) => el.textContent.trim()))
  step('görünen 3 kayıt en son yüklenenler (yeniden eskiye)', newest.join('|') === csvFiles.slice(-3).reverse().map((f) => f.split('/').pop()).join('|'), newest.join(' | '))
  await shot('390-gunluk-yuklenen-dosyalar-son-3')
  await tap('upload-list-toggle')
  await sleep(150)
  const opened = { rows: (await page.$$(sel('upload-row'))).length, deletes: (await page.$$(sel('upload-delete'))).length, toggle: await text('upload-list-toggle') }
  step('"Tümünü göster": bütün kayıtlar ve hepsinin Sil düğmesi görünür', opened.rows === total && opened.deletes === total, `${opened.rows} satır · ${opened.deletes} Sil · ${opened.toggle}`)
  step('gösterim kısalınca veri silinmedi (kayıt sayısı aynı)', (await count('uploads')) === total)
  // En eski kayıt (kapalıyken görünmeyen) silinebiliyor mu
  await page.$$eval(sel('upload-delete'), (els) => els[els.length - 1].click())
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="upload-row"] button')].find((b) => b.textContent.includes('Evet, sil')).click())
  for (let t = 0; t < 100 && (await count('uploads')) !== total - 1; t++) await sleep(100)
  step('en eski kayıt (yalnızca "Tümünü göster" ile erişilen) silinebiliyor', (await count('uploads')) === total - 1, `${await count('uploads')} kayıt kaldı`)
  await sleep(300)
  const afterDelete = { rows: (await page.$$(sel('upload-row'))).length, toggle: (await page.$(sel('upload-list-toggle'))) !== null }
  step('3 kayıt kalınca liste tam görünür, düğme kalkar', afterDelete.rows === 3 && !afterDelete.toggle, `${afterDelete.rows} satır`)

  // ───────── 3) Her bölüm tam bir sekmede ─────────
  await page.waitForSelector(sel('member-admin-members'))
  const placed = await page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => [
          id,
          [...document.querySelector(`[data-testid="admin-panel-${id}"]`).children].map((card) => (card.querySelector('h2, summary')?.textContent ?? '?').trim()),
        ]),
      ),
    TAB_IDS,
  )
  for (const id of TAB_IDS) step(`${TABS[id].label}: ${TABS[id].titles.length} kart, beklenen sırada`, placed[id].join('|') === TABS[id].titles.join('|'), placed[id].join(' · '))
  const all = Object.values(placed).flat()
  step('15 bölümün hepsi sayfada ve her biri tam bir kez', all.length === 15 && new Set(all).size === 15 && !all.includes('?'), `${all.length} kart`)
  const outside = await page.$$eval('main > section, main > details', (els) => els.length)
  step('sekmelerin dışında kalan kart yok', outside === 0, `${outside}`)

  // ───────── 4) Rozetler ve her sekmede görünen uyarılar ─────────
  step('veri var, yedek yok: VERİ-YEDEK sekmesinde ⚠ rozeti', (await page.$(sel('admin-tab-badge-veri'))) !== null && (await page.$(sel('admin-tab-badge-gunluk'))) === null && (await page.$(sel('admin-tab-badge-ai'))) === null)
  const siteLevel = await page.$eval(sel('publish-site-version'), (el) => el.dataset.level)
  step('"üye sitesi eski olabilir" (older) tek başına ÜYELER rozetini yakmıyor', siteLevel === 'older' && (await page.$(sel('admin-tab-badge-uyeler'))) === null, `site: ${siteLevel}`)
  const visibleOnAll = async (id) => {
    const seen = []
    for (const tab of TAB_IDS) {
      await openTab(tab)
      if (await page.$eval(sel(id), (el) => el.getClientRects().length > 0).catch(() => false)) seen.push(tab)
    }
    return seen
  }
  step('yedek hatırlatıcı bandı dört sekmede de üstte', (await visibleOnAll('backup-reminder')).length === 4)
  step('yayın durumu satırı dört sekmede de üstte', (await visibleOnAll('admin-publish-status')).length === 4)
  step('yayın durumu: henüz yayın yok', (await text('admin-last-publication')) === 'henüz yayın yok', await text('admin-last-publication'))

  // ───────── 5) Durum koruma: gizli sekmede hiçbir şey kaybolmaz ─────────
  await openTab('gunluk')
  await setValue('league-text', leagueText)
  await tap('league-preview')
  await page.waitForSelector(sel('league-preview-result'))
  const leagueBefore = { text: await value('league-text'), preview: await text('league-preview-result') }

  await openTab('ai')
  await page.$eval(sel('raw-compare'), (el) => (el.open = true))
  const rawAnswer = '#1 | SON | Deneme FC | 01.10.2026 | Rakip SK | İÇ | 2-1 | İY 1-0 | LİG | kaynak\n#1 | TOPLAM | Deneme FC | oynanan 4 | 2-1-1 | 6-4 | 7 puan | lig sırası 3 | kaynak'
  await setValue('raw-text-A', rawAnswer)
  await setValue('raw-label-A', 'Deneme AI')
  await sleep(150)
  const rawBefore = { text: await value('raw-text-A'), label: await value('raw-label-A'), summary: await text('raw-summary-A'), matches: (await page.$$(sel('raw-match'))).length }

  await openTab('uyeler')
  await setValue('member-add-username', 'sekme1')
  await tap('member-add')
  await page.waitForSelector(sel('member-issued-sekme1'), { timeout: 30000 })
  const password = await page.$eval(sel('member-issued-password'), (el) => el.textContent.trim())
  await setValue('member-bulk-input', 'sekme2\nsekme3')
  await setValue('keybackup-pass', 'yarim-yazilmis-parola')
  await sleep(150)
  const bulkBefore = { text: await value('member-bulk-input'), preview: await text('member-bulk-preview') }
  step('şifre kutusu açıkken ÜYELER sekmesinde ⚠ rozeti', (await page.$(sel('admin-tab-badge-uyeler'))) !== null)

  await openTab('veri')
  await setValue('market-conflict-limit', '37')
  const hiddenNow = await page.evaluate((p) => ({ onScreen: document.body.innerText.includes(p), inDom: document.body.textContent.includes(p) }), password)
  step('başka sekmedeyken şifre ekranda görünmez ama bellekte durur; ÜYELER rozeti yanık', !hiddenNow.onScreen && hiddenNow.inDom && (await page.$(sel('admin-tab-badge-uyeler'))) !== null)
  // Sekmeler iki tur dolaşılır.
  for (const id of ['gunluk', 'ai', 'uyeler', 'veri', 'ai', 'gunluk', 'veri', 'uyeler']) await openTab(id)

  const issuedAfter = await page.$eval(sel('member-issued-password'), (el) => ({ text: el.textContent.trim(), shown: el.getClientRects().length > 0 })).catch(() => null)
  step('açık şifre kutusu sekme değişiminden sonra duruyor (aynı şifre, görünür)', issuedAfter?.text === password && issuedAfter.shown && password.length > 10)
  step('toplu üye alanı ve önizlemesi duruyor', (await value('member-bulk-input')) === bulkBefore.text && (await text('member-bulk-preview')) === bulkBefore.preview && bulkBefore.preview.startsWith('2 geçerli ad'), bulkBefore.preview)
  step('yarım yazılmış anahtar yedeği parolası duruyor', (await value('keybackup-pass')) === 'yarim-yazilmis-parola')
  await openTab('gunluk')
  const leagueAfter = { text: await value('league-text'), preview: await text('league-preview-result').catch(() => null) }
  step('lig tablosu metni ve önizlemesi duruyor', leagueAfter.text === leagueBefore.text && leagueAfter.preview === leagueBefore.preview && leagueBefore.text.length > 20, leagueBefore.preview.slice(0, 70))
  await openTab('ai')
  const rawAfter = { text: await value('raw-text-A'), label: await value('raw-label-A'), summary: await text('raw-summary-A'), matches: (await page.$$(sel('raw-match'))).length, open: await page.$eval(sel('raw-compare'), (el) => el.open) }
  step('AI cevap kutusu, etiketi, özeti ve karşılaştırma kartları duruyor; bölüm açık kaldı', rawAfter.text === rawBefore.text && rawAfter.label === 'Deneme AI' && rawAfter.summary === rawBefore.summary && rawAfter.matches === rawBefore.matches && rawAfter.matches > 0 && rawAfter.open, `${rawAfter.summary} · ${rawAfter.matches} maç kartı`)
  await openTab('veri')
  step('kaydedilmemiş ayar taslağı (piyasa çelişkisi sınırı) duruyor', (await value('market-conflict-limit')) === '37')

  // ───────── 6) Kısayollar ─────────
  step('üye anahtar yedeği bandı dört sekmede de üstte', (await visibleOnAll('member-key-reminder')).length === 4)
  const landed = async (id) => {
    await sleep(350)
    return page.evaluate((s) => {
      const top = document.querySelector(s).getBoundingClientRect().top
      const header = document.querySelector('header').getBoundingClientRect().bottom
      return { top: Math.round(top), header: Math.round(header), inView: top >= header - 1 && top < window.innerHeight }
    }, sel(id))
  }
  await openTab('gunluk')
  await tap('member-key-reminder-open')
  const keyLanding = await landed('member-admin-keybackup')
  step('anahtar yedeği bandındaki düğme ÜYELER sekmesini açıp yedek kartına kaydırıyor', onlyTab(await tabState(), 'uyeler') && keyLanding.inView, `kart üstü ${keyLanding.top}px, menü altı ${keyLanding.header}px`)
  await openTab('ai')
  await page.evaluate(() => window.scrollTo(0, 0))
  await tap('admin-publish-shortcut')
  const publishLanding = await landed('member-admin-publish')
  step('"Yayınla →" kısayolu ÜYELER sekmesini açıp YAYINLA kartına kaydırıyor (yayın başlatmıyor)', onlyTab(await tabState(), 'uyeler') && publishLanding.inView && (await page.$(sel('publish-confirm-box'))) === null && (await count('publications')) === 0, `kart üstü ${publishLanding.top}px, menü altı ${publishLanding.header}px`)
  step('YAYINLA düğmesi kopyalanmadı: sayfada tek "Yayınla…" düğmesi', (await page.$$(sel('publish-start'))).length === 1)
  const issuedStill = await page.$eval(sel('member-issued-password'), (el) => el.textContent.trim())
  step('kısayollar da şifre kutusunu kapatmadı', issuedStill === password)
  await tap('member-issued-close')
  await setValue('member-bulk-input', '')
  await setValue('keybackup-pass', '')

  // ───────── 7) Sekme çubuğu ölçüleri (iki rozet de yanıkken: en geniş hâl) ve taşma ─────────
  // 390 ve 360: telefon; "390 pencere": kaydırma çubuğu 15 px yer kaplayan dar masaüstü penceresi (içerik 375 px).
  for (const [name, width, height, mobile] of [['390 px', 390, 844, true], ['360 px', 360, 740, true], ['390 px pencere', 390, 844, false], ['1280 px', 1280, 900, false]]) {
    await setScreen(width, height, mobile)
    await openTab('gunluk')
    const bar = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="admin-tabs"]')
      const tabs = [...box.querySelectorAll('[role=tab]')].map((el) => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const lines = Math.round((rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight))
        return { label: el.textContent.trim(), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), lines, clipped: el.scrollWidth > el.clientWidth }
      })
      const rect = box.getBoundingClientRect()
      return { tabs, left: Math.round(rect.left), right: Math.round(rect.right), inner: document.documentElement.clientWidth, scrolls: box.scrollWidth > box.clientWidth }
    })
    report.sekmeCubugu.push({ ekran: name, ...bar })
    const oneRow = new Set(bar.tabs.map((t) => t.top)).size === 1
    const detail = bar.tabs.map((t) => `${t.label} ${t.width}px/${t.lines} satır`).join(' · ')
    step(`${name}: sekme çubuğu ekrana sığıyor; kaydırma ve kırpılan etiket yok`, bar.right <= bar.inner && bar.left >= 0 && !bar.scrolls && bar.tabs.every((t) => !t.clipped), `içerik ${bar.inner}px · ${detail}`)
    if (mobile || width === 1280) step(`${name}: dört sekme tek sırada ve hiçbir etiket iki satıra kırılmadı (iki rozet de yanıkken)`, oneRow && bar.tabs.every((t) => t.lines === 1), detail)
    for (const id of TAB_IDS) {
      await openTab(id)
      const size = await overflow()
      step(`${name}: ${TABS[id].label} sekmesinde yatay taşma yok`, size.scroll <= size.inner, `${size.scroll} / ${size.inner}`)
      if (name === '390 px' || width === 1280) await shot(`${width}-${id}`)
    }
    if (name !== '1280 px') {
      await openTab('gunluk')
      await page.evaluate(() => (document.querySelector('header').style.position = 'static'))
      const file = join(shots, `${name.replace(/ px/, '').replace(' ', '-')}-sekme-cubugu.png`)
      await (await page.$(sel('admin-tabs'))).screenshot({ path: file })
      await page.evaluate(() => (document.querySelector('header').style.position = ''))
      report.ekranlar.push(file)
    }
  }
  await setScreen(390, 844, true)
  await openTab('gunluk')

  // ───────── 8) Yayın geçmişi: son 5 ─────────
  await page.waitForFunction((s) => document.querySelector(s) && !document.querySelector(s).disabled, { timeout: 20000 }, sel('publish-start'))
  for (let n = 1; n <= 6; n++) {
    // Özet yeniden hesaplanırken düğme kısa süre kapalı kalabilir: onay kutusu açılana dek denenir.
    for (let t = 0; t < 50 && !(await page.$(sel('publish-confirm'))); t++) {
      await tap('publish-start').catch(() => undefined)
      await sleep(200)
    }
    await tap('publish-confirm')
    await page.waitForFunction((s, no) => document.querySelector(s)?.textContent.includes(`Yayın no ${no} `), { timeout: 30000 }, sel('publish-result'), n)
    await page.waitForFunction((s) => document.querySelector(s) && !document.querySelector(s).disabled, { timeout: 20000 }, sel('publish-start'))
    if (n === 5) step('5 yayında "Daha fazla göster" yok, 5 satır', (await page.$$(`${sel('publish-history')} tbody tr`)).length === 5 && (await page.$(sel('publish-history-toggle'))) === null)
    clearDownloads()
  }
  const historyRows = () => page.$$eval(`${sel('publish-history')} tbody tr`, (trs) => trs.map((tr) => tr.querySelector('th').textContent.trim()).join())
  step('yayın geçmişi: 6 yayından yalnızca son 5 satır görünür (6…2)', (await historyRows()) === '6,5,4,3,2' && (await text('publish-history-count')) === 'Son 5 yayın gösteriliyor · toplam 6 kayıt', `${await historyRows()} · ${await text('publish-history-count')}`)
  await shot('390-uyeler-yayin-gecmisi-son-5')
  await tap('publish-history-toggle')
  await sleep(150)
  step('"Daha fazla göster": 6 satırın hepsi', (await historyRows()) === '6,5,4,3,2,1' && (await text('publish-history-toggle')) === 'Daha az göster', await historyRows())
  step('yayın geçmişi verisi aynen duruyor (6 kayıt)', (await count('publications')) === 6)
  await tap('publish-history-toggle')
  const lastLine = await text('admin-last-publication')
  step('üstteki satır: "Son yayın: no 6 · zaman · gün"', /^no 6 · \d{1,2} \S+ \d{4} \d{2}:\d{2} · gün \d{1,2} \S+ \d{4}$/.test(lastLine), lastLine)
  await openTab('gunluk')
  step('son yayın satırı GÜNLÜK sekmesinde de görünüyor', await page.$eval(sel('admin-last-publication'), (el) => el.getClientRects().length > 0))
  await shot('390-gunluk-ust-bantlar')

  // ───────── 9) Üye sitesi paketi açamıyorsa: her sekmede kırmızı bant + rozet ─────────
  memberSitePayload = 1
  await go('/admin')
  await page.waitForSelector(sel('admin-site-incompatible'), { timeout: 15000 })
  const banner = await text('admin-site-incompatible')
  step('üye sitesi paketi açamıyor: GÜNLÜK sekmesinde de kırmızı bant ve ÜYELER rozeti', banner.includes('AÇAMAZ') && (await page.$(sel('admin-tab-badge-uyeler'))) !== null && (await visibleOnAll('admin-site-incompatible')).length === 4, banner.slice(0, 70))
  await openTab('gunluk')
  await shot('390-gunluk-uye-sitesi-acamiyor')
  const noOverflow = await overflow()
  step('kırmızı bant varken 390 px taşma yok', noOverflow.scroll <= noOverflow.inner, `${noOverflow.scroll} / ${noOverflow.inner}`)

  step('konsol hatası yok (tüm deneme boyunca)', report.konsolHatalari.length === 0, report.konsolHatalari.slice(0, 3).join(' | '))
} catch (error) {
  failed = true
  step('beklenmeyen hata', false, error?.stack?.split('\n').slice(0, 3).join(' ') ?? String(error))
} finally {
  await browser.close().catch(() => undefined)
  server.close()
  rmSync(profile, { recursive: true, force: true })
  rmSync(downloads, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(outDir, 'rapor.json'), JSON.stringify(report, null, 1) + '\n')
console.log(`\n${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · rapor: ${join(outDir, 'rapor.json')}`)
process.exit(failed ? 1 : 0)
