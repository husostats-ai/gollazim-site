import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

// İÇE AKTARMA SINIRI: üye sayfası veri deposunu, ham veriyi, analiz motorunu, yapay zekâ
// ve uygulama durumu modüllerini (doğrudan ya da dolaylı) içe aktaramaz. Üye sayfasının
// çalışma zamanında ulaşabildiği dosyaların tamamı aşağıdaki izinli listede olmalıdır.

/** Dosyanın çalışma zamanı içe aktarmaları (yalnızca tip olanlar sayılmaz) */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const m of source.matchAll(/^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/gm)) {
    if (m[1]) continue
    // `import { type A, type B } from` de yalnızca tiptir.
    const named = /^\{([\s\S]*)\}$/.exec(m[2].trim())
    if (named && named[1].split(',').map((x) => x.trim()).filter(Boolean).every((x) => x.startsWith('type '))) continue
    found.push(m[3])
  }
  for (const m of source.matchAll(/^\s*import\s+'([^']+)'/gm)) found.push(m[1])
  for (const m of source.matchAll(/import\(\s*'([^']+)'\s*\)/g)) found.push(m[1])
  return found
}

function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null // paketler (react vb.)
  const base = normalize(join(dirname(from), specifier))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate) && /\.(tsx?|css)$/.test(candidate)) return candidate
  throw new Error(`Çözülemeyen içe aktarma: ${specifier} (${from})`)
}

/** Giriş dosyalarından çalışma zamanında ulaşılan tüm proje dosyaları */
function reachable(entries: string[]): string[] {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file) || file.endsWith('.css')) continue
    seen.add(file)
    for (const specifier of runtimeImports(file)) {
      const target = resolve(file, specifier)
      if (target) queue.push(target)
    }
  }
  return [...seen].sort()
}

const ALLOWED = [
  // Üye bileşenleri
  'src/member/MemberAnalysis.tsx',
  'src/member/MemberApp.tsx',
  'src/member/MemberCard.tsx',
  'src/member/MemberLegalNotice.tsx',
  'src/member/MemberLogin.tsx',
  'src/member/MemberShell.tsx',
  'src/member/MemberStatsPage.tsx',
  'src/member/howToRead.ts',
  'src/member/legalNotice.ts',
  'src/member/main.tsx',
  'src/member/MemberHighlights.tsx',
  'src/member/view.ts',
  // Üye servisleri (paket kurucu payload.ts burada YOK: o admin tarafıdır ve analiz motorunu kullanır)
  'src/services/member/controller.ts',
  'src/services/member/crypto.ts',
  'src/services/member/labels.ts',
  'src/services/member/schema.ts',
  'src/services/member/session.ts',
  'src/services/member/sessionFlag.ts',
  'src/services/member/source.ts',
  // Ayar ve biçimlendirme (veri içermez)
  'src/config/categories.ts',
  'src/config/member.ts',
  'src/config/memberTexts.ts',
  'src/utils/date.ts',
  'src/utils/format.ts',
  // Uygulamayla ortak, yalnızca çizim yapan bileşenler
  'src/components/EmptyState.tsx',
  'src/components/PageTitle.tsx',
  'src/components/Stars.tsx',
  'src/components/stats/chartTheme.ts',
].sort()

describe('üye sayfasının içe aktarma sınırı', () => {
  // İki giriş: ayrı üye sitesinin girişi (main.tsx) ve admin sitesindeki üye rotasının yüklediği MemberApp.
  const files = reachable(['src/member/main.tsx', 'src/member/MemberApp.tsx'])

  it('ulaşılan dosyalar tam olarak izinli listedir', () => {
    expect(files).toEqual(ALLOWED)
  })

  it('veri deposu, ham veri, analiz, yapay zekâ, görsel ve uygulama durumu modüllerinin hiçbirine ulaşılmaz', () => {
    const forbidden = [/^src\/services\/(data|csv|ai|analysis|results|stats|story|image|league|daily|referans)\//, /^src\/state\//, /^src\/pages\//, /^src\/services\/member\/payload\.ts$/, /columnAliases|storyTexts|dexie/, /^src\/App\.tsx$|^src\/AdminRoot\.tsx$/]
    expect(files.filter((f) => forbidden.some((p) => p.test(f)))).toEqual([])
  })

  it('src/member altındaki her bileşen denetimin kapsamındadır', () => {
    const sources = readdirSync('src/member').filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts')).map((f) => `src/member/${f}`)
    expect(sources.filter((f) => !files.includes(f))).toEqual([])
  })

  it('uygulamanın girişi üye sayfasını ve uygulamanın geri kalanını ayrı parçalar olarak yükler', () => {
    const main = readFileSync('src/main.tsx', 'utf8')
    // Doğrudan (aynı parçaya giren) içe aktarmalar: yalnızca oturum işareti ve stil.
    const direct = [...main.matchAll(/^import\s+(?:[\s\S]*?\s+from\s+)?'(\.[^']+)'/gm)].map((m) => m[1])
    expect(direct.sort()).toEqual(['./index.css', './services/member/sessionFlag'])
    expect(main).toContain("lazy(() => import('./AdminRoot'))")
    expect(main).toContain("lazy(() => import('./member/MemberApp'))")
    expect(runtimeImports('src/services/member/sessionFlag.ts')).toEqual([])
    // Uygulamanın geri kalanı üye sayfası koduna bağlı değildir.
    expect(reachable(['src/AdminRoot.tsx']).filter((f) => f.startsWith('src/member/'))).toEqual([])
  })

  it('ayrı üye sitesinin girişi yalnızca üye uygulamasını ve stili yükler', () => {
    const entry = readFileSync('src/member/main.tsx', 'utf8')
    expect(runtimeImports('src/member/main.tsx').filter((s) => s.startsWith('.')).sort()).toEqual(['../index.css', './MemberApp'])
    // Admin parçası, oturum yönlendirmesi ya da tembel yükleme yok; uygulama kökte çalışır.
    expect(entry).not.toMatch(/AdminRoot|sessionFlag|lazy\(/)
    expect(entry).toContain('<MemberApp basePath="" />')
    expect(entry).toContain('<Route path="/uye/*" element={<Navigate to="/" replace />} />')
    expect(readFileSync('uye.html', 'utf8')).toContain('src="/src/member/main.tsx"')
    // Üye sitesinin ulaştığı dosyalar, admin sitesindeki üye rotasınınkilerle aynıdır (giriş dışında).
    expect(reachable(['src/member/main.tsx']).filter((f) => f !== 'src/member/main.tsx')).toEqual(reachable(['src/member/MemberApp.tsx']))
  })

  it('denetim boş değil: analiz motoru gerçekten yasak dosyalara ulaşır', () => {
    expect(reachable(['src/services/member/payload.ts']).some((f) => f.startsWith('src/services/analysis/'))).toBe(true)
    expect(runtimeImports('src/member/MemberCard.tsx')).not.toContain('../services/analysis/types')
  })
})
