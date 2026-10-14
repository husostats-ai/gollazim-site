// Geliştirme aracı: gün seçiciyi (hızlı günler + "Önceki günler" takvimi) DERLENMİŞ admin sitesinde,
// gerçek tarayıcıda dener.
//
//   npm run build && GUN_CSV=<bir FootyStats CSV'si> node scripts/gun-secici-e2e.mjs
//
// Test verisi: CSV yüklenir, maçları tarayıcının kendi IndexedDB'sinde 10'dan fazla güne kopyalanır
// (yarın, bugün ve 45 güne kadar geriye; bazı günler bilerek boş). "Bugün" Europe/Istanbul'a göredir.
// Denenenler: hızlı düğmeler yalnızca bugün − 6 … bugün ve ileri tarihli verili günler; "Önceki günler"
// ve seçili eski gün düğmesi tablist'in dışında; takvim klavyeyle (oklar, PageUp/PageDown, Home/End,
// Enter, Esc, Tab döngüsü); soluk gün seçilemiyor; dışarı dokunma kapatıyor; GÜNLÜK sekmesindeki iki
// seçiciden aynı anda tek takvim açık; 360/390/1280 px genişlikte yatay taşma yok, takvim ekrana sığıyor.
// Tarayıcı geçici bir profille açılır; kullanıcının tarayıcı verisine dokunulmaz.
// Çıktı: GUN_SECICI_OUT (varsayılan samples/gun-secici): ekran/*.png ve rapor.json
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const csvFile = resolve(process.env.GUN_CSV ?? '')
if (!process.env.GUN_CSV || !existsSync(csvFile)) {
  console.error('GUN_CSV bir FootyStats CSV dosyasını göstermeli.')
  process.exit(1)
}
const dist = resolve('dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ yok: önce npm run build.')
  process.exit(1)
}
const outDir = resolve(process.env.GUN_SECICI_OUT ?? 'samples/gun-secici')
const shots = join(outDir, 'ekran')
mkdirSync(shots, { recursive: true })
const puppeteer = createRequire(join(resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107')), 'x.js'))('puppeteer-core')

/** Verisi olan günler: bugüne göre gün farkı (−3, −5, −9 … bilerek boş) */
const OFFSETS = [1, 0, -1, -2, -4, -6, -7, -8, -10, -12, -15, -25, -40, -45]

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/gollazim-uye/surum.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end('{"commit":"0000000","payloadVersion":99}\n')
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
const profile = mkdtempSync(join(tmpdir(), 'gollazim-gun-'))

const report = { adimlar: [], ekranlar: [], konsolHatalari: [] }
let failed = false
const step = (name, ok, detail = '') => {
  if (!ok) failed = true
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail !== '' && { ayrinti: String(detail) }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ` — ${detail}` : ''}`)
}
const sel = (id) => `[data-testid="${id}"]`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shift = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  page.on('dialog', (dialog) => void dialog.accept())
  page.on('pageerror', (error) => report.konsolHatalari.push(error.message))
  page.on('console', (message) => message.type() === 'error' && report.konsolHatalari.push(message.text()))

  const go = async (hash) => {
    await page.goto(`${site}#${hash}`, { waitUntil: 'networkidle0' })
    await sleep(300)
  }
  const setScreen = (width, height, mobile) => page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile })
  const shot = async (name) => {
    const file = join(shots, `${name}.png`)
    await page.screenshot({ path: file })
    report.ekranlar.push(file)
  }
  const exists = async (selector) => (await page.$(selector)) !== null
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName)
  const press = async (key, times = 1) => {
    for (let i = 0; i < times; i++) await page.keyboard.press(key)
    await sleep(60)
  }
  const overflow = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: document.documentElement.clientWidth }))

  // ───────── Test verisi ─────────
  await go('/admin')
  await (await page.$(sel('csv-input'))).uploadFile(csvFile)
  await page.waitForFunction(() => !document.body.textContent.includes('İşleniyor…'), { timeout: 30_000 })
  await sleep(500)
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
  const days = OFFSETS.map((o) => shift(today, o))
  const copied = await page.evaluate(
    (targets) =>
      new Promise((done, fail) => {
        const req = indexedDB.open('gollazim')
        req.onerror = () => fail(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('matches', 'readwrite')
          const store = tx.objectStore('matches')
          const all = store.getAll()
          all.onsuccess = () => {
            const source = all.result.filter((m) => m.date === all.result[0].date)
            for (const m of all.result) store.delete(m.id)
            for (const date of targets) for (const m of source) store.put({ ...m, id: `${m.id}-${date}`, date })
            tx.oncomplete = () => done({ perDay: source.length, days: targets.length })
          }
          tx.onerror = () => fail(tx.error)
        }
      }),
    days,
  )
  step('test verisi: maçlar 10\'dan fazla güne kopyalandı', copied.days > 10 && copied.perDay > 0, `${copied.days} gün × ${copied.perDay} maç · bugün ${today}`)

  // Yalnızca hash değişince sayfa yeniden yüklenmez; veri deposundan yeniden okunsun.
  await page.reload({ waitUntil: 'networkidle0' })
  const expectedQuick = days.filter((d) => d >= shift(today, -6))
  const expectedOlder = days.filter((d) => d < shift(today, -6))

  // ───────── Ana sayfa: hızlı düğmeler ─────────
  await go('/')
  const strip = await page.evaluate(() => {
    const picker = document.querySelector('[data-testid="date-picker"]')
    const list = picker.querySelector('[role="tablist"]')
    return {
      tabs: [...list.querySelectorAll('[role="tab"]')].map((el) => ({ id: el.dataset.testid, text: el.textContent.trim(), selected: el.getAttribute('aria-selected') })),
      olderInTablist: list.querySelector('[data-testid="date-older"]') !== null,
      olderExists: picker.querySelector('[data-testid="date-older"]') !== null,
    }
  })
  step('hızlı düğmeler: bugün − 6 … bugün ve yarın; boş günler yok', JSON.stringify(strip.tabs.map((t) => t.id)) === JSON.stringify(expectedQuick.map((d) => `date-chip-${d}`)), strip.tabs.map((t) => t.text).join(' · '))
  step('ilk düğmeler "Yarın", "Bugün", "Dün"', strip.tabs.slice(0, 3).map((t) => t.text).join(',') === 'Yarın,Bugün,Dün')
  step('varsayılan gün bugün seçili', strip.tabs.find((t) => t.selected === 'true')?.id === `date-chip-${today}`)
  step('"Önceki günler" var ve role=tablist\'in dışında', strip.olderExists && !strip.olderInTablist)

  // ───────── Takvim: klavye ─────────
  await page.focus(sel('date-older'))
  await press('Enter')
  await page.waitForSelector(sel('day-calendar'))
  step('Enter takvimi açar; odak en yeni eski güne gider', (await active()) === `day-calendar-${expectedOlder[0]}`, await active())
  step('"Önceki günler" aria-expanded=true', (await page.$eval(sel('date-older'), (el) => el.getAttribute('aria-expanded'))) === 'true')
  const head = await page.$$eval(`${sel('day-calendar')} th`, (els) => els.map((el) => el.textContent.trim()).join(' '))
  step('takvim başlığı Türkçe ve Pazartesi\'den başlıyor', head === 'Pzt Sal Çar Per Cum Cmt Paz', head)
  const todayCell = await page.$eval(sel(`day-calendar-${today}`), (el) => ({ current: el.getAttribute('aria-current'), label: el.getAttribute('aria-label'), border: getComputedStyle(el).borderTopColor })).catch(() => null)
  step('bugün işaretli (aria-current=date, çerçeve)', todayCell?.current === 'date' && todayCell.label.includes('bugün') && todayCell.border !== 'rgba(0, 0, 0, 0)', JSON.stringify(todayCell))

  // −7'den sola: −8 (verili), −9 (boş, soluk)
  await press('ArrowLeft', 2)
  const empty = shift(today, -9)
  const emptyCell = await page.$eval(sel(`day-calendar-${empty}`), (el) => ({ disabled: el.getAttribute('aria-disabled'), label: el.getAttribute('aria-label'), focused: el === document.activeElement }))
  step('ok tuşları günler arasında gezer; boş gün soluk ve aria-disabled', emptyCell.focused && emptyCell.disabled === 'true' && emptyCell.label.endsWith('veri yok'), JSON.stringify(emptyCell))
  await press('Enter')
  step('soluk gün Enter ile seçilemiyor; takvim açık kalıyor', (await exists(sel('day-calendar'))) && (await page.$eval(sel(`date-chip-${today}`), (el) => el.getAttribute('aria-selected'))) === 'true')
  await page.$eval(sel(`day-calendar-${empty}`), (el) => el.click())
  await sleep(100)
  step('soluk gün tıklanınca da seçilemiyor', (await exists(sel('day-calendar'))) && !(await exists(sel('date-pinned'))))

  const title = () => page.$eval(sel('day-calendar-title'), (el) => el.textContent.trim())
  const before = await title()
  await press('PageUp')
  const prevMonth = await title()
  await press('PageDown')
  step('PageUp/PageDown ay değiştirir', prevMonth !== before && (await title()) === before, `${before} → ${prevMonth} → ${await title()}`)
  await press('Home')
  const home = await active()
  await press('End')
  const end = await active()
  const weekday = (id) => (new Date(`${id.replace('day-calendar-', '')}T00:00:00Z`).getUTCDay() + 6) % 7
  step('Home haftanın Pazartesi\'sine, End Pazar\'ına gider', weekday(home) === 0 && weekday(end) === 6, `${home} · ${end}`)

  // Tab pencerenin içinde döner
  const inside = []
  for (let i = 0; i < 5; i++) {
    await press('Tab')
    inside.push(await page.evaluate(() => document.querySelector('[data-testid="day-calendar"]').contains(document.activeElement)))
  }
  step('Tab odağı takvimin içinde tutar', inside.every(Boolean))

  await press('Escape')
  step('Esc kapatır; odak "Önceki günler" düğmesine döner', !(await exists(sel('day-calendar'))) && (await active()) === 'date-older', await active())

  // Klavyeyle eski bir gün seç: −10
  const pick = shift(today, -10)
  await press('Enter')
  await page.waitForSelector(sel('day-calendar'))
  // Açılış −7; −10'a üç kez sol.
  await press('ArrowLeft', 3)
  step('−10 gününe gelindi', (await active()) === `day-calendar-${pick}`, await active())
  await press('Enter')
  await sleep(400)
  const pinned = await page.$eval(sel('date-pinned'), (el) => ({ text: el.textContent.trim(), pressed: el.getAttribute('aria-pressed'), label: el.getAttribute('aria-label'), inTablist: el.closest('[role="tablist"]') !== null })).catch(() => null)
  step('Enter seçer ve kapatır; seçili eski gün düğmesi tablist dışında, seçili renkte görünüyor', !(await exists(sel('day-calendar'))) && pinned?.pressed === 'true' && !pinned.inTablist, JSON.stringify(pinned))
  step('seçimden sonra odak "Önceki günler" düğmesinde', (await active()) === 'date-older', await active())
  step('hızlı düğmelerin hiçbiri seçili değil', (await page.$$eval('[role="tab"][aria-selected="true"]', (els) => els.filter((el) => el.dataset.testid?.startsWith('date-chip-')).length)) === 0)
  const longPick = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${pick}T00:00:00Z`))
  const heading = await page.$$eval('p span.font-bold', (els) => els.map((el) => el.textContent.trim()))
  step('gün başlığı seçilen eski günü gösteriyor', heading.includes(longPick) && !heading.includes('BUGÜNÜN MAÇLARI'), longPick)

  // Takvim seçili günü işaretler; dışarı dokunma kapatır
  await page.click(sel('date-pinned'))
  await page.waitForSelector(sel('day-calendar'))
  step('seçili gün düğmesi takvimi seçili günde açar (aria-selected)', (await page.$eval(sel(`day-calendar-${pick}`), (el) => el.getAttribute('aria-selected'))) === 'true' && (await active()) === `day-calendar-${pick}`)
  await page.mouse.click(5, 800)
  await sleep(150)
  step('dışarı tıklama takvimi kapatır', !(await exists(sel('day-calendar'))))
  await page.click(sel('date-older'))
  await page.waitForSelector(sel('day-calendar'))
  await page.touchscreen.tap(20, 830)
  await sleep(150)
  step('dışarı dokunma takvimi kapatır', !(await exists(sel('day-calendar'))))

  // Ay sınırı: en eski aydan geriye gidilmez
  await page.click(sel('date-older'))
  await page.waitForSelector(sel('day-calendar'))
  for (let i = 0; i < 6; i++) if (!(await page.$eval(sel('day-calendar-prev'), (el) => el.disabled))) await page.click(sel('day-calendar-prev'))
  const oldest = days[days.length - 1]
  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${oldest}T00:00:00Z`))
  step('ay geçişi verisi olan en eski ayda durur', (await title()) === monthName && (await page.$eval(sel('day-calendar-prev'), (el) => el.disabled)), await title())
  for (let i = 0; i < 6; i++) if (!(await page.$eval(sel('day-calendar-next'), (el) => el.disabled))) await page.click(sel('day-calendar-next'))
  const newestMonth = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${days[0]}T00:00:00Z`))
  step('ay geçişi verisi olan en yeni ayda durur', (await title()) === newestMonth && (await page.$eval(sel('day-calendar-next'), (el) => el.disabled)), await title())
  step('ay düğmesi sınırda kapanınca odak takvimde kalır', await page.evaluate(() => document.querySelector('[data-testid="day-calendar"]').contains(document.activeElement)), await active())
  await press('Escape')
  step('sınırdan sonra Esc yine kapatır', !(await exists(sel('day-calendar'))))

  // Hızlı güne dönüş: sabit düğme kaybolur
  await page.click(sel(`date-chip-${today}`))
  await sleep(300)
  step('hızlı gün seçilince seçili eski gün düğmesi kalkar', !(await exists(sel('date-pinned'))))
  await page.click(sel('date-older'))
  await page.waitForSelector(sel('day-calendar'))
  await page.click(sel(`day-calendar-${pick}`))
  await sleep(400)
  step('fareyle eski gün seçilir', await exists(sel('date-pinned')))

  // ───────── Genişlikler: taşma ve takvimin sığması ─────────
  const pages = [
    ['ana', '/'],
    ['skor', '/skor-girisi'],
    ['ai', '/ai-analizi'],
    ['admin-gunluk', '/admin'],
    ['admin-veri', '/admin?sekme=veri'],
  ]
  for (const [name, width, height, mobile] of [['360', 360, 740, true], ['390', 390, 844, true], ['1280', 1280, 900, false]]) {
    await setScreen(width, height, mobile)
    for (const [pageName, hash] of pages) {
      await go(hash)
      const pickers = await page.$$(sel('date-picker'))
      let ok = pickers.length > 0
      let detail = `${pickers.length} seçici`
      for (let i = 0; i < pickers.length; i++) {
        const visible = await pickers[i].evaluate((el) => el.offsetParent !== null)
        if (!visible) continue
        const older = await pickers[i].$(sel('date-older'))
        await older.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        const buttons = await pickers[i].evaluate((el) => [...el.querySelectorAll('[data-testid="date-older"],[data-testid="date-pinned"]')].map((b) => b.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.right)]))
        await older.click()
        await page.waitForSelector(sel('day-calendar'))
        const box = await page.$eval(sel('day-calendar'), (el) => {
          const r = el.getBoundingClientRect()
          return { left: Math.round(r.left), right: Math.round(r.right), inner: document.documentElement.clientWidth }
        })
        const size = await overflow()
        const gutter = mobile ? 16 : 0
        const fits = box.left >= gutter && box.right <= box.inner - gutter && buttons.every(([l, r]) => l >= 0 && r <= box.inner) && size.scroll <= size.inner
        if (!fits) ok = false
        detail += ` · #${i + 1}: takvim ${box.left}–${box.right}/${box.inner}, düğmeler ${JSON.stringify(buttons)}, sayfa ${size.scroll}/${size.inner}`
        if (i === 0) await shot(`${name}-${pageName}`)
        await press('Escape')
      }
      step(`${name} px · ${pageName}: yatay taşma yok, düğmeler ekranda, takvim ${mobile ? '16 px kenar boşluğuyla ' : ''}sığıyor`, ok, detail)
    }
  }

  // ───────── GÜNLÜK sekmesi: iki seçici, tek takvim ─────────
  await setScreen(390, 844, true)
  await go('/admin')
  const gunluk = await page.$$(`${sel('admin-panel-gunluk')} ${sel('date-picker')}`)
  if (gunluk.length >= 2) {
    await (await gunluk[0].$(sel('date-older'))).click()
    await page.waitForSelector(sel('day-calendar'))
    // Klavyeyle açılan ikinci takvim (dışarı tıklama olmadan) birinciyi kapatmalı.
    await (await gunluk[1].$(sel('date-older'))).focus()
    await press('Enter')
    await sleep(150)
    const open = await page.$$eval(sel('day-calendar'), (els) => els.length)
    const owner = await gunluk[1].evaluate((el) => el.querySelector('[data-testid="day-calendar"]') !== null)
    step('GÜNLÜK: iki seçiciden aynı anda tek takvim açık', open === 1 && owner, `${gunluk.length} seçici, ${open} açık takvim`)
    const ids = await page.$$eval(`${sel('admin-panel-gunluk')} [role="dialog"][aria-labelledby]`, (els) => els.map((el) => el.getAttribute('aria-labelledby')))
    step('takvim başlık kimliği tekil (useId)', ids.length === 1, ids.join(','))
    await press('Escape')
  } else {
    step('GÜNLÜK: iki seçici bulunamadı', false, `${gunluk.length} seçici`)
  }

  step('konsolda hata yok', report.konsolHatalari.length === 0, report.konsolHatalari.join(' | '))
} catch (error) {
  failed = true
  console.error(error)
  report.adimlar.push({ ad: 'beklenmeyen hata', sonuc: 'HATA', ayrinti: String(error?.stack ?? error) })
} finally {
  await browser.close()
  server.close()
  rmSync(profile, { recursive: true, force: true })
  writeFileSync(join(outDir, 'rapor.json'), JSON.stringify(report, null, 2))
  const errors = report.adimlar.filter((a) => a.sonuc === 'HATA').length
  console.log(`\n${report.adimlar.length - errors}/${report.adimlar.length} adım geçti · rapor: ${join(outDir, 'rapor.json')}`)
  process.exit(failed ? 1 : 0)
}
