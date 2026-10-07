// Geliştirme aracı: referans story görsellerini gerçek tarayıcıda üretir ve özetlerini yazar.
//
//   npm run referans          (önce: story-girdi.json'u üretir)
//   npm run referans:png
//
// Girdi : REF_OUT/story-girdi.json (varsayılan samples/ref)
// Çıktı : REF_OUT/png/*.png ve REF_OUT/png.sha256
//
// Tarayıcı her çalıştırmada yeni, geçici bir profille açılır; kullanıcının tarayıcı
// verisine dokunulmaz. puppeteer-core projenin bağımlılığı değildir (Chrome 107 için
// 19.2.2 gerekir): repo dışında bir klasöre kurulur ve yeri PUPPETEER_DIR ile verilir;
// verilmezse ~/araclar/puppeteer-chrome107 kullanılır. Kurulum README'de yazar.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'

const outDir = resolve(process.env.REF_OUT ?? 'samples/ref')
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
const puppeteerDir = resolve(process.env.PUPPETEER_DIR ?? join(homedir(), 'araclar', 'puppeteer-chrome107'))
let puppeteer
try {
  puppeteer = createRequire(join(puppeteerDir, 'x.js'))('puppeteer-core')
} catch {
  console.error(`puppeteer-core bulunamadı: ${puppeteerDir}\nKurulum: mkdir -p ${puppeteerDir} && cd ${puppeteerDir} && npm init -y && npm i puppeteer-core@19.2.2`)
  process.exit(1)
}
const input = JSON.parse(readFileSync(join(outDir, 'story-girdi.json'), 'utf8'))

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const address = server.httpServer.address()
const origin = `http://127.0.0.1:${address.port}`
const profile = mkdtempSync(join(tmpdir(), 'gollazim-ref-'))
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'chrome', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu'] })

try {
  const page = await browser.newPage()
  await page.goto(origin, { waitUntil: 'networkidle0' })
  mkdirSync(join(outDir, 'png'), { recursive: true })
  const lines = []
  for (const { file, data } of input.stories) {
    const base64 = await page.evaluate(
      async (story, texts) => {
        const { createStoryPng } = await import('/src/services/image/storyGenerator.ts')
        const bytes = new Uint8Array(await (await createStoryPng(story, texts)).arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(binary)
      },
      data,
      input.texts,
    )
    const png = Buffer.from(base64, 'base64')
    writeFileSync(join(outDir, 'png', file), png)
    lines.push(`${createHash('sha256').update(png).digest('hex')}  ${file}`)
  }
  writeFileSync(join(outDir, 'png.sha256'), lines.join('\n') + '\n')
  console.log(`${lines.length} PNG yazıldı: ${join(outDir, 'png')} (${await browser.version()})`)
} finally {
  await browser.close()
  await server.close()
  rmSync(profile, { recursive: true, force: true })
}
