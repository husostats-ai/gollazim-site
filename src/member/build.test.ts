import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// AYRI ÜYE SİTESİNİN derleme çıktısı denetimi (scripts/lib/uye-cikti-denetim.mjs).
// Yayın komutu çıktıyı göndermeden önce bu denetimden geçirir. Burada denetimin kendisi
// sınanır; dist-uye varsa (npm run build:uye) gerçek çıktı da denetlenir.

interface Check {
  ok: boolean
  problems: string[]
  files: { path: string; bytes: number; sha256: string }[]
  totalBytes: number
  commit: string | null
  payloadVersion: number | null
}
let checkMemberBuild: (dir: string) => Check
const work = mkdtempSync(join(tmpdir(), 'gollazim-uye-cikti-'))
const PAGE = `<!doctype html><html lang="tr"><head><meta name="robots" content="noindex, nofollow, noarchive" /><link rel="icon" type="image/png" href="./favicon.png" /><title>GOLLAZIM</title><script type="module" crossorigin src="/gollazim-uye/assets/uye-AbCd1234.js"></script><link rel="stylesheet" crossorigin href="/gollazim-uye/assets/uye-AbCd1234.css"></head><body><div id="root"></div></body></html>`

/** Geçerli, küçük bir üye sitesi çıktısı kurar; changes ile dosya eklenir, değiştirilir ya da (null) silinir */
function site(changes: Record<string, string | null> = {}): string {
  const dir = mkdtempSync(join(work, 'site-'))
  const files: Record<string, string | null> = {
    'index.html': PAGE,
    'favicon.png': 'png',
    'logo-256.png': 'png',
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'surum.json': '{"commit":"abc1234","payloadVersion":2}\n',
    'assets/uye-AbCd1234.js': 'console.log("üye")',
    'assets/uye-AbCd1234.css': 'body{color:#fff}',
    'assets/inter-latin-wght-normal-Dx4kXJAl.woff2': 'font',
    'assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2': 'font',
    ...changes,
  }
  mkdirSync(join(dir, 'assets'), { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}
const problems = (changes: Record<string, string | null>): string => {
  const result = checkMemberBuild(site(changes))
  expect(result.ok).toBe(false)
  return result.problems.join(' | ')
}
const inScript = (code: string) => ({ 'assets/uye-AbCd1234.js': `console.log("üye");${code}` })

beforeAll(async () => {
  checkMemberBuild = ((await import(/* @vite-ignore */ resolve('scripts/lib/uye-cikti-denetim.mjs'))) as { checkMemberBuild: typeof checkMemberBuild }).checkMemberBuild
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

describe('üye sitesi çıktı denetimi', () => {
  it('geçerli çıktı kabul edilir; dosya listesi, boyut ve sürüm döner', () => {
    const result = checkMemberBuild(site())
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.files.map((f) => f.path)).toEqual(['assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2', 'assets/inter-latin-wght-normal-Dx4kXJAl.woff2', 'assets/uye-AbCd1234.css', 'assets/uye-AbCd1234.js', 'favicon.png', 'index.html', 'logo-256.png', 'robots.txt', 'surum.json'])
    expect(result).toMatchObject({ commit: 'abc1234', payloadVersion: 2 })
    expect(result.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)
  })

  it('dosya listesi izinli kümeyle birebir aynı olmalı', () => {
    expect(problems({ 'logo.png': 'büyük logo' })).toContain('izinli olmayan dosya: logo.png')
    expect(problems({ 'paket.json': '{}' })).toContain('izinli olmayan dosya: paket.json')
    expect(problems({ 'assets/AdminKok-AbCd1234.js': 'x' })).toContain('izinli olmayan dosya')
    expect(problems({ 'assets/veri.csv': 'a,b' })).toContain('izinli olmayan dosya')
    expect(problems({ '.env': 'X=1' })).toContain('izinli olmayan dosya: .env')
    expect(problems({ 'surum.json': null })).toContain('eksik dosya: surum.json')
    expect(problems({ 'assets/uye-Baska123.js': 'console.log(1)' })).toContain('JS dosyası sayısı 2')
  })

  it('veri deposu, tarayıcı veritabanı, kalıcı depo ve CSV okuyucu izi reddedilir', () => {
    expect(problems(inScript('import("dex' + 'ie")'))).toContain('veri deposu kitaplığı')
    expect(problems(inScript('indexed' + 'DB.open("gollazim")'))).toContain('tarayıcı veritabanı')
    expect(problems(inScript('local' + 'Storage.getItem("x")'))).toContain('kalıcı tarayıcı deposu')
    expect(problems(inScript('Papa.' + 'parse(t)'))).toContain('CSV okuyucu')
  })

  it('admin parçası, admin sayfası metinleri ve öğeleri reddedilir', () => {
    expect(problems(inScript('lazy(()=>import("./Admin' + 'Root"))'))).toContain('uygulamanın admin parçası')
    expect(problems(inScript('"SKOR Gİ' + 'RİŞİ"'))).toContain('admin sayfası metni')
    expect(problems(inScript('"Veriyi dışa' + ' aktar (JSON)"'))).toContain('admin sayfası metni')
    expect(problems(inScript('"ÜYE SAYFASI: ÜYE' + 'LER"'))).toContain('admin sayfası metni')
    expect(problems(inScript('"data-testid":"csv-in' + 'put"'))).toContain('admin sayfası öğesi')
    expect(problems(inScript('"/gollazim-si' + 'te/"'))).toContain('admin sitesinin adresi')
  })

  it('paket şifreleme ve şifre üretme kodu reddedilir; çözme kodu serbesttir', () => {
    expect(problems(inScript('subtle.wrap' + 'Key("raw",a,b,"AES-KW")'))).toContain('paket şifreleme kodu')
    expect(problems(inScript('subtle.generate' + 'Key(a,true,["enc' + 'rypt"])'))).toContain('paket şifreleme kodu')
    expect(problems(inScript('crypto.getRandom' + 'Values(new Uint8Array(16))'))).toContain('şifre üretme kodu')
    expect(checkMemberBuild(site(inScript('subtle.unwrapKey("raw",a,b,"AES-KW","AES-GCM",false,["decrypt"]);subtle.deriveBits({name:"PBKDF2"},k,256)'))).ok).toBe(true)
  })

  it('analiz motoru, ham veri alanı ve admin kaydı izi reddedilir', () => {
    expect(problems(inScript('analyze' + 'Day(m,t)'))).toContain('analiz motoru')
    expect(problems(inScript('"Odds' + '_BTTS_Yes"'))).toContain('ham veri alanı')
    expect(problems(inScript('stat(m,"home' + 'Xg")'))).toContain('ham veri alanı')
    expect(problems(inScript('db.ai' + 'Verdicts.toArray()'))).toContain('admin kaydı alanı')
  })

  it('gizli anahtar, yedek, paket ve ham CSV izi reddedilir', () => {
    expect(problems(inScript('"-----BEGIN ' + 'PRIVATE KEY-----"'))).toContain('özel anahtar')
    expect(problems(inScript('"ghp_' + 'A'.repeat(36) + '"'))).toContain('GitHub erişim anahtarı')
    expect(problems(inScript('"/england/kuzey-vs-guney-h2h-' + 'stats"'))).toContain('ham CSV satırı')
    expect(problems(inScript('{"format":"gollazim-' + 'uye-paket"}'))).toContain('yayın paketi ya da anahtar yedeği')
    expect(problems(inScript('{"app":"gollazim",' + '"version":1}'))).toContain('JSON yedek')
  })

  it('yasak terimler reddedilir: üye sayfasının metinlerinde hiç geçmemeli', () => {
    for (const word of ['Başarı or' + 'anı', 'Pi' + 'yasa %64', 'Kay' + 'nak: x', 'Gol orta' + 'laması', 'İnternet bağ' + 'lantınız', 'footy' + 'stats', 'c' + 'sv yükle', 'od' + 'ds']) expect(problems(inScript(`"${word}"`)), word).toContain('yasak terim')
    expect(problems(inScript('"x' + 'G 1,9"'))).toContain('yasak terim "xg"')
    // Küçültülmüş kodda rastgele harf dizisi olarak geçen "xg" sözcük sayılmaz.
    expect(checkMemberBuild(site(inScript('var axgb=1'))).ok).toBe(true)
  })

  it('sayfa: noindex, başlık, simge ve taban yol zorunlu; dış adres yasak', () => {
    expect(problems({ 'index.html': PAGE.replace('noindex, nofollow, noarchive', 'index, follow') })).toContain('noindex etiketi yok')
    expect(problems({ 'index.html': PAGE.replace('<title>GOLLAZIM</title>', '<title>Üye</title>') })).toContain('başlık beklenenden farklı')
    expect(problems({ 'index.html': PAGE.replace('<link rel="icon" type="image/png" href="./favicon.png" />', '') })).toContain('simge bağlantısı yok')
    expect(problems({ 'index.html': PAGE.replace('/gollazim-uye/assets/uye-AbCd1234.js', '/assets/uye-AbCd1234.js') })).toContain('beklenmeyen adres')
    expect(problems({ 'index.html': PAGE.replace('uye-AbCd1234.js', 'uye-Yok12345.js') })).toContain('çıktıda olmayan dosyaya işaret ediyor')
    expect(problems({ 'index.html': PAGE.replace('</head>', '<script src="https://ornek.invalid/izle.js"></script></head>') })).toMatch(/beklenmeyen adres|dış adres/)
  })

  it('sürüm bilgisi geçerli olmalı', () => {
    expect(problems({ 'surum.json': 'bozuk' })).toContain('surum.json geçersiz')
    expect(problems({ 'surum.json': '{"commit":"abc1234"}' })).toContain('surum.json geçersiz')
    expect(problems({ 'surum.json': '{"commit":"abc1234","payloadVersion":2,"ek":1}' })).toContain('surum.json geçersiz')
    expect(checkMemberBuild(site({ 'surum.json': '{"commit":"bilinmiyor","payloadVersion":2}' })).ok).toBe(true)
  })

  it('çıktı klasörü yoksa açık hata', () => {
    expect(checkMemberBuild(join(work, 'yok')).problems.join()).toContain('çıktı klasörü yok')
  })
})

// Gerçek derleme çıktısı (npm run build:uye sonrası)
describe.runIf(existsSync('dist-uye'))('üye sitesi: gerçek derleme çıktısı (dist-uye)', () => {
  it('denetimden geçer; yalnızca üye uygulaması vardır', () => {
    const result = checkMemberBuild('dist-uye')
    expect(result.problems).toEqual([])
    expect(result.files).toHaveLength(9)
    // Büyük logo ve admin sitesinin dosyaları çıktıda yoktur.
    expect(result.files.map((f) => f.path)).not.toContain('logo.png')
    expect(result.totalBytes).toBeLessThan(700_000)
  })

  it('üye uygulamasının metinleri ve çözme kodu çıktıdadır (denetim boş bir dosyayı geçirmiyor)', () => {
    const script = checkMemberBuild('dist-uye').files.find((f) => f.path.endsWith('.js'))!
    const code = readFileSync(join('dist-uye', script.path), 'utf8')
    for (const marker of ['Nasıl okunur?', 'Kullanıcı adı veya şifre hatalı.', 'unwrapKey', 'PBKDF2', '/gollazim-yayin/paket.json', 'gollazim.uye.oturum']) expect(code, marker).toContain(marker)
    expect(script.bytes).toBeGreaterThan(200_000)
  })
})
