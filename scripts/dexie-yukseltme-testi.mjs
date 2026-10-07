// Geliştirme aracı: veritabanı şeması yükseltmesini gerçek tarayıcıda dener.
//
//   ESKI_DIST=<eski sürümün derlemesi> YENI_DIST=dist UYE_BACKUP=samples/gollazim-yedek-….json \
//     node scripts/dexie-yukseltme-testi.mjs
//
// 1) ESKİ sürümle, yeni ve geçici bir profilde, JSON yedekten dolu bir veritabanı kurar.
// 2) AYNI profili YENİ sürümle açar: eski tabloların kayıt sayısı ve içerik özeti birebir
//    aynı mı, yeni tablolar boş mu, uygulama hatasız açılıyor mu, dışa aktarılan yedek
//    özgün yedekle aynı mı.
// 3) Yükseltilmiş profili yeniden ESKİ sürümle açar: geri dönüşün mümkün olup olmadığını gösterir.
// Kullanıcının tarayıcı verisine dokunulmaz. Çıktı: YUKSELTME_OUT (varsayılan samples/yukseltme).
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const oldDist = resolve(process.env.ESKI_DIST ?? '')
const newDist = resolve(process.env.YENI_DIST ?? 'dist')
const backupFile = resolve(process.env.UYE_BACKUP ?? '')
const outDir = resolve(process.env.YUKSELTME_OUT ?? 'samples/yukseltme')
for (const [name, path] of [['ESKI_DIST', oldDist], ['YENI_DIST', newDist], ['UYE_BACKUP', backupFile]])
  if (!existsSync(path) || path === resolve('')) {
    console.error(`${name} verilmedi ya da bulunamadı.`)
    process.exit(1)
  }
mkdirSync(outDir, { recursive: true })
const puppeteer = createRequire(join(resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107')), 'x.js'))('puppeteer-core')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }
/** Sunulan derleme; aynı adres (aynı origin) üzerinden değiştirilir ki veritabanı aynı kalsın */
let dist = oldDist
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
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
const profile = mkdtempSync(join(tmpdir(), 'gollazim-yukseltme-'))
const downloads = mkdtempSync(join(tmpdir(), 'gollazim-indirme-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (text) => createHash('sha256').update(text).digest('hex')

const report = { adimlar: [], tablolar: [] }
const step = (name, ok, detail = '') => {
  report.adimlar.push({ ad: name, sonuc: ok ? 'TAMAM' : 'HATA', ...(detail && { ayrinti: String(detail) }) })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Aynı profille tarayıcıyı açar, işi yapar, kapatır (kapatınca veritabanı diske yazılır) */
async function withBrowser(work) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const errors = []
  page.on('dialog', (d) => void d.accept())
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await (await page.target().createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  try {
    return await work(page, errors)
  } finally {
    await browser.close()
  }
}

/** Veritabanının ham dökümü: sürüm ve her tablo için kayıt sayısı + içerik özeti (Dexie'siz, doğrudan IndexedDB) */
const dump = (page) =>
  page.evaluate(
    () =>
      new Promise((done, fail) => {
        const open = indexedDB.open('gollazim')
        open.onerror = () => fail(new Error(String(open.error)))
        open.onsuccess = async () => {
          const db = open.result
          const tables = {}
          for (const name of [...db.objectStoreNames].sort()) {
            const store = db.transaction(name).objectStore(name)
            const [keys, values] = await Promise.all([new Promise((r) => (store.getAllKeys().onsuccess = (e) => r(e.target.result))), new Promise((r) => (store.getAll().onsuccess = (e) => r(e.target.result)))])
            // Anahtar sırası kayıt içinde korunur: JSON metni kaydın birebir içeriğidir.
            tables[name] = { count: values.length, json: JSON.stringify(keys.map((key, i) => [key, values[i]])), indexes: [...store.indexNames].sort().join(','), keyPath: String(store.keyPath) }
          }
          const version = db.version
          db.close()
          done({ version, tables })
        }
      }),
  )
const summarize = (raw) => ({ version: raw.version, tables: Object.fromEntries(Object.entries(raw.tables).map(([name, t]) => [name, { count: t.count, sha256: sha(t.json), indexes: t.indexes, keyPath: t.keyPath }])) })

const go = async (page, hash) => {
  await page.goto(`${site}#${hash}`, { waitUntil: 'networkidle0' })
  await sleep(300)
}
const takeDownload = async () => {
  for (let i = 0; i < 100; i++) {
    const files = readdirSync(downloads).filter((f) => !f.endsWith('.crdownload'))
    if (files.length > 0) {
      await sleep(200)
      const text = readFileSync(join(downloads, files[0]), 'utf8')
      for (const f of readdirSync(downloads)) rmSync(join(downloads, f))
      return text
    }
    await sleep(100)
  }
  throw new Error('indirme gelmedi')
}
const exportBackup = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Veriyi dışa aktar')).click())
  return takeDownload()
}

let failed = false
try {
  const original = readFileSync(backupFile, 'utf8')
  const originalBackup = JSON.parse(original)

  // 1) ESKİ sürüm: yedekten dolu veritabanı
  const before = await withBrowser(async (page, errors) => {
    await go(page, '/admin')
    await (await page.$('input[type=file][accept="application/json,.json"]')).uploadFile(backupFile)
    await page.waitForFunction(() => document.body.innerText.includes('Yedek yüklendi'), { timeout: 20000 })
    await sleep(500)
    const raw = await dump(page)
    step('eski sürüm: yedek yüklendi, konsol hatası yok', errors.length === 0, errors[0] ?? `${originalBackup.matches.length} maç, ${originalBackup.picks.length} dondurulmuş öneri`)
    return raw
  })
  const oldSummary = summarize(before)
  step('eski sürümün veritabanı sürümü 6', before.version === 60, `IndexedDB sürümü ${before.version} (Dexie sürümü x10)`)
  const oldTables = Object.keys(before.tables)
  step('eski sürümde 11 tablo', oldTables.length === 11, oldTables.join(', '))

  // 2) YENİ sürüm: aynı profil
  dist = newDist
  const after = await withBrowser(async (page, errors) => {
    for (const hash of ['/', '/kategori/2-5-ust', '/skor-girisi', '/istatistik', '/ai-analizi', '/admin']) await go(page, hash)
    await page.waitForSelector('[data-testid="member-admin-members"]', { timeout: 15000 })
    const raw = await dump(page)
    step('yeni sürüm: uygulama normal açıldı (6 sayfa), konsol hatası yok', errors.length === 0, errors[0] ?? '')
    await go(page, '/istatistik')
    await page.waitForSelector('[data-testid="overall-rate"]', { timeout: 15000 })
    const rate = await page.$eval('[data-testid="overall-rate"]', (el) => el.textContent.trim())
    await go(page, '/admin')
    const exported = await exportBackup(page)
    return { raw, rate, exported }
  })
  const newSummary = summarize(after.raw)
  step('yeni sürümün veritabanı sürümü 7', after.raw.version === 70, `IndexedDB sürümü ${after.raw.version}`)

  let same = true
  for (const name of oldTables) {
    const a = oldSummary.tables[name]
    const b = newSummary.tables[name]
    const equal = !!b && a.count === b.count && a.sha256 === b.sha256 && a.indexes === b.indexes && a.keyPath === b.keyPath
    same &&= equal
    report.tablolar.push({ tablo: name, kayit: a.count, once: a.sha256.slice(0, 16), sonra: b?.sha256.slice(0, 16) ?? '-', sonuc: equal ? 'AYNI' : 'FARKLI' })
  }
  step('eski 11 tablonun kayıt sayısı, içerik özeti, anahtarı ve indeksleri birebir aynı', same, report.tablolar.map((t) => `${t.tablo} ${t.kayit}`).join(' · '))
  const added = Object.keys(after.raw.tables).filter((n) => !oldTables.includes(n))
  step('üç yeni tablo eklendi ve boş', added.join() === 'memberMeta,members,publications' && added.every((n) => after.raw.tables[n].count === 0), added.map((n) => `${n}: ${after.raw.tables[n].count}`).join(', '))
  step('dondurulmuş öneriler birebir aynı', before.tables.picks.json === after.raw.tables.picks.json, `${before.tables.picks.count} öneri`)
  step('istatistik sayfası dolu', /^%\d/.test(after.rate), after.rate)

  // Dışa aktarılan yedek özgün yedekle aynı mı (dışa aktarma anı dışında)
  const exportedBackup = JSON.parse(after.exported)
  const normalized = JSON.stringify({ ...exportedBackup, exportedAt: originalBackup.exportedAt })
  step('yeni sürümden alınan yedek özgün yedekle bayt bayt aynı (dışa aktarma anı dışında)', normalized === original.trimEnd(), `${normalized.length} / ${original.trimEnd().length} bayt · sha256 ${sha(normalized).slice(0, 16)}`)
  step('normal yedekte üye alanı yok', !/member|uye|publication/i.test(Object.keys(exportedBackup).join()))
  // Adım 0 referansı bu dosyayla yeniden üretilebilir.
  writeFileSync(join(outDir, 'yukseltme-sonrasi-yedek.json'), normalized)

  // 3) Geri dönüş: yükseltilmiş profili ESKİ sürümle açmak
  dist = oldDist
  const rollback = await withBrowser(async (page, errors) => {
    await go(page, '/')
    await sleep(800)
    const raw = await dump(page).catch((e) => ({ error: String(e) }))
    const rows = await page.$$eval('main li', (els) => els.length)
    await go(page, '/istatistik')
    const rate = await page.$eval('[data-testid="overall-rate"]', (el) => el.textContent.trim()).catch(() => null)
    return { errors, rows, rate, version: raw.version, picks: raw.tables?.picks.count, samePicks: raw.tables?.picks.json === before.tables.picks.json }
  })
  report.geriDonus = rollback
  console.log(`\nGERİ DÖNÜŞ DENEMESİ (yükseltilmiş profil + eski sürüm):\n  konsol/sayfa hatası: ${rollback.errors.length ? rollback.errors.join(' | ').slice(0, 300) : 'yok'}\n  eski sürüm veriyi gösteriyor mu: ana sayfada ${rollback.rows} öneri satırı, istatistik ${rollback.rate ?? 'YOK'}\n  veritabanı sürümü: ${rollback.version}, dondurulmuş öneri: ${rollback.picks} (içerik ${rollback.samePicks ? 'aynı' : 'FARKLI'})`)
  step('geri dönüş denemesinde veri silinmedi (veritabanı yerinde ve aynı)', rollback.version === 70 && rollback.samePicks === true)
} catch (error) {
  failed = true
  step('beklenmeyen hata', false, error?.stack?.split('\n').slice(0, 2).join(' ') ?? String(error))
} finally {
  server.close()
  rmSync(profile, { recursive: true, force: true })
  rmSync(downloads, { recursive: true, force: true })
}
failed ||= report.adimlar.some((a) => a.sonuc === 'HATA')
writeFileSync(join(outDir, 'yukseltme-rapor.json'), JSON.stringify(report, null, 1) + '\n')
console.log(`\n${report.adimlar.filter((a) => a.sonuc === 'TAMAM').length}/${report.adimlar.length} adım tamam · rapor: ${join(outDir, 'yukseltme-rapor.json')}`)
process.exit(failed ? 1 : 0)
