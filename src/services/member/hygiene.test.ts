import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// DEPO VE DERLEME TEMİZLİĞİ: repoya ve yayınlanan derleme çıktısına ham veri, yedek,
// yayın paketi, şifre ya da anahtar girmediğini denetler. README'deki yayın öncesi
// kontrol listesinin otomatik karşılığıdır. dist/ denetimi yalnızca derleme çıktısı
// varken çalışır: yayından önce `npm run build && npm test` sırasıyla çalıştırın.

const tracked = ((): string[] | null => {
  try {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  } catch {
    return null
  }
})()

/** Repoda bulunabilecek JSON dosyaları; veri dosyası (yedek, paket) bunlardan biri olamaz */
const JSON_ALLOWED = ['package.json', 'package-lock.json', 'tsconfig.json']
const PUBLIC_ALLOWED = ['favicon.png', 'logo-256.png', 'logo.png', 'robots.txt']
const BINARY = /\.(png|jpg|jpeg|ico|woff2?)$/i

// Desenler parça parça yazılır ki bu dosyanın kendisi eşleşmesin.
const SECRET_PATTERNS: [string, RegExp][] = [
  ['özel anahtar', new RegExp('-----BEGIN [A-Z ]*PRIVATE' + ' KEY-----')],
  ['Supabase service role anahtarı', new RegExp('service' + '_role|sb_' + 'secret_')],
  ['JWT', new RegExp('eyJhbGciOi' + '[A-Za-z0-9_-]{20,}')],
  ['GitHub erişim anahtarı', new RegExp('gh[pousr]_' + '[A-Za-z0-9]{30,}|github_pat_' + '[A-Za-z0-9_]{30,}')],
  // Gerçek FootyStats maç bağlantısı: ham CSV satırının işareti
  ['FootyStats maç bağlantısı', new RegExp('/[a-z0-9-]+/[a-z0-9-]+-vs-[a-z0-9-]+-h2h-' + 'stats')],
  // Şifreli yayın paketi ya da üye anahtar yedeği dosyası (JSON içinde biçim imi)
  ['yayın paketi / üye anahtar yedeği', new RegExp('"format"\\s*:\\s*"gollazim-' + 'uye-')],
  ['JSON yedek', new RegExp('"app"\\s*:\\s*"gollazim"\\s*,\\s*"version"')],
]

const scan = (path: string, text: string): string[] => SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${path}: ${name}`)

describe.runIf(tracked)('depo temizliği (izlenen dosyalar)', () => {
  const files = tracked ?? []

  it('veri, yedek, paket, ortam ve anahtar dosyası izlenmiyor', () => {
    const forbidden = [/\.csv$/i, /(^|\/)\.env(\.(?!example$).*)?$/, /yedek/i, /^samples\//, /gollazim-(yayin|uye)-/, /(^|\/)paket\.json$/, /\.(pem|key|p12|pfx)$/i, /^dist\//]
    expect(files.filter((f) => forbidden.some((p) => p.test(f)))).toEqual([])
  })

  it('JSON dosyaları yalnızca proje ayar dosyalarıdır', () => {
    expect(files.filter((f) => f.endsWith('.json') && !JSON_ALLOWED.includes(f))).toEqual([])
  })

  it('public/ altında yalnızca logo, simge ve robots.txt var', () => {
    expect(files.filter((f) => f.startsWith('public/')).map((f) => f.slice('public/'.length)).sort()).toEqual(PUBLIC_ALLOWED)
    // İzlenmeyen bir dosya da derlemeye girer: klasörün kendisine de bakılır.
    expect(readdirSync('public').sort()).toEqual(PUBLIC_ALLOWED)
  })

  it('izlenen dosyaların içeriğinde anahtar, yedek, paket ya da ham CSV izi yok', () => {
    const hits = files.filter((f) => !BINARY.test(f) && f !== 'package-lock.json' && existsSync(f)).flatMap((f) => scan(f, readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })

  it('.gitignore veri ve gizli dosyaları dışlıyor', () => {
    const ignore = readFileSync('.gitignore', 'utf8').split('\n')
    for (const line of ['.env', '.env.*', 'samples/', '*.csv', 'gollazim-yedek-*.json', 'gollazim-yayin-*.json', 'gollazim-uye-*.json', 'paket.json', 'dist', 'dist-uye']) expect(ignore, `.gitignore: ${line}`).toContain(line)
  })
})

const DIST = 'dist'
const listDist = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listDist(join(dir, name)) : [join(dir, name)]))

describe.runIf(existsSync(DIST))('derleme çıktısı temizliği (dist/)', () => {
  const files = existsSync(DIST) ? listDist(DIST).map((f) => f.slice(DIST.length + 1)) : []

  it('yalnızca sayfa, logo, simge, robots.txt ve derlenmiş varlıklar var', () => {
    const allowed = [/^index\.html$/, /^favicon\.png$/, /^logo(-256)?\.png$/, /^robots\.txt$/, /^assets\/[A-Za-z0-9._-]+\.(js|css|woff2)$/]
    expect(files.filter((f) => !allowed.some((p) => p.test(f)))).toEqual([])
  })

  it('içerikte anahtar, yedek, paket ya da ham CSV izi yok', () => {
    expect(files.filter((f) => !BINARY.test(f)).flatMap((f) => scan(f, readFileSync(join(DIST, f), 'utf8')))).toEqual([])
  })

  it('üyelerin indirdiği parçalar ham veri, analiz ve veri deposu kodu içermez', () => {
    const scripts = files.filter((f) => /^assets\/.+\.js$/.test(f))
    // Eski bir derleme çıktısında üye sayfası yoktur; o zaman bu denetim atlanır.
    if (!scripts.some((f) => f.startsWith('assets/MemberApp-'))) return
    expect(scripts.some((f) => f.startsWith('assets/AdminRoot-'))).toBe(true)
    // Uygulamanın geri kalanı (AdminRoot) dışındaki her parça üye sayfasında yüklenebilir.
    // CSV kolon adları, oran alanları, IndexedDB kitaplığı ve CSV okuyucu yalnızca AdminRoot'tadır.
    for (const file of scripts.filter((f) => !f.startsWith('assets/AdminRoot-'))) {
      const code = readFileSync(join(DIST, file), 'utf8')
      for (const marker of ['Odds_', 'oddsHome', 'Pre-Match xG', 'FootyStats', 'IndexedDB', 'Dexie', 'aiVerdicts', 'scoreSnapshot']) expect(code, `${file}: ${marker}`).not.toContain(marker)
    }
  })
})

describe('temizlik desenleri', () => {
  it('örnek sızıntıları yakalar, temiz metni geçirir', () => {
    const leaked = [
      '-----BEGIN ' + 'PRIVATE KEY-----',
      'SUPABASE_KEY=service' + '_role',
      '/england/kuzey-vs-guney-h2h-' + 'stats',
      '{"format":"gollazim-' + 'uye-paket","v":1}',
      '{"app":"gollazim",' + '"version":1,"exportedAt":""}',
    ]
    for (const sample of leaked) expect(scan('x', sample), sample).toHaveLength(1)
    expect(scan('x', 'İleride Supabase’e geçilirse: VITE_SUPABASE_ANON_KEY=')).toEqual([])
  })
})
