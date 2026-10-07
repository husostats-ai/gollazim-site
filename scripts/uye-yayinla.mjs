// AYRI ÜYE SİTESİNİ derler, denetler ve yayınlar: https://husostats-ai.github.io/gollazim-uye/
//
//   npm run uye-yayinla                 denetle, derle, yayınla, canlıda doğrula
//   npm run uye-yayinla -- --dogrula    yalnızca: canlıdaki dosyalar yereldeki dist-uye ile aynı mı
//
// Yayından ÖNCE şunlar şarttır; biri sağlanmazsa hiçbir şey gönderilmez:
//   - çalışma ağacı temiz ve HEAD, uzak main ile aynı (yayınlanan sürüm repoda bulunmalı)
//   - tip denetimi ve TÜM testler geçiyor
//   - üye derlemesi (dist-uye) çıktı denetiminden geçiyor (scripts/lib/uye-cikti-denetim.mjs):
//     yalnızca izinli dosyalar; veri deposu, admin sayfaları, paket şifreleme kodu, ham veri izi yok
// Sonra üye sitesinin reposu geçici bir klasörde SIFIRDAN kurulur (geçmişsiz tek commit:
// derlenmiş dosyalar + .nojekyll), force-push edilir ve canlı dosyaların özetleri karşılaştırılır.
//
// Kimlik: yalnızca mevcut `gh` oturumu. Hiçbir anahtar dosyaya, repoya ya da ekrana yazılmaz.
// Admin sitesine (bu repo) ve yayın paketine (gollazim-yayin) dokunmaz.
// Ayarlar (isteğe bağlı): UYE_REPO (hesap/repo), UYE_SITE_URL, UYE_BEKLE_SN.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { checkMemberBuild } from './lib/uye-cikti-denetim.mjs'

const REPO = process.env.UYE_REPO ?? 'husostats-ai/gollazim-uye'
const SITE = process.env.UYE_SITE_URL ?? `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/`
const WAIT_SECONDS = Number(process.env.UYE_BEKLE_SN ?? 600)
const DIST = resolve('dist-uye')

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim()
/** Uzun süren adımı çalıştırır; başarısızsa son satırlarını gösterip durur */
function step(label, command, args) {
  process.stdout.write(`… ${label}`)
  const started = Date.now()
  try {
    run(command, args)
    console.log(`\r✓ ${label} (${((Date.now() - started) / 1000).toFixed(0)} sn)`)
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n  ')
    fail(`${label} BAŞARISIZ; hiçbir şey gönderilmedi.\n  ${output}`)
  }
}

/** Canlıdaki her dosyayı çekip yereldeki özetle karşılaştırır; farklı ya da eksik olanları döner */
async function compareLive(files) {
  const different = []
  for (const file of files) {
    try {
      const response = await fetch(`${SITE}${file.path === 'index.html' ? '' : file.path}?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== file.sha256) different.push(`${file.path} (HTTP ${response.status})`)
    } catch {
      different.push(`${file.path} (ulaşılamadı)`)
    }
  }
  return different
}

const args = process.argv.slice(2)
const verifyOnly = args.includes('--dogrula')
if (args.length > (verifyOnly ? 1 : 0)) fail('Kullanım: npm run uye-yayinla   ya da   npm run uye-yayinla -- --dogrula')

if (verifyOnly) {
  const build = checkMemberBuild(DIST)
  if (!build.ok) fail(`Yereldeki dist-uye denetimden geçmiyor:\n  - ${build.problems.join('\n  - ')}`)
  const different = await compareLive(build.files)
  if (different.length > 0) fail(`Canlı site yereldeki derlemeyle AYNI DEĞİL (${SITE}):\n  - ${different.join('\n  - ')}`)
  console.log(`✓ Canlı site yereldeki derlemeyle bayt bayt aynı: ${build.files.length} dosya, ${build.totalBytes} bayt, sürüm ${build.commit}\n  ${SITE}`)
  process.exit(0)
}

// 1) Ön koşullar
let login
try {
  if (run('git', ['status', '--porcelain']) !== '') fail('Çalışma ağacı temiz değil. Değişiklikleri commit edin ya da geri alın; hiçbir şey gönderilmedi.')
  run('git', ['fetch', '--quiet', 'origin'])
  const head = run('git', ['rev-parse', 'HEAD'])
  if (head !== run('git', ['rev-parse', 'origin/main'])) fail('HEAD, uzak main ile aynı değil. Üye sitesi yalnızca repoya gönderilmiş main sürümünden yayınlanır; hiçbir şey gönderilmedi.')
  run('gh', ['auth', 'status'])
  login = run('gh', ['api', 'user', '-q', '.login'])
  console.log(`✓ Çalışma ağacı temiz, sürüm ${head.slice(0, 7)} uzak main ile aynı`)
} catch (error) {
  fail(`Ön koşullar denetlenemedi (git / gh oturumu): ${String(error.message).split('\n')[0]}`)
}

// 2) Denetimler ve derleme
step('tip denetimi', 'npx', ['tsc', '--noEmit'])
step('tüm testler', 'npx', ['vitest', 'run'])
step('üye sitesi derlemesi', 'npx', ['vite', 'build', '--config', 'vite.uye.config.ts'])
const build = checkMemberBuild(DIST)
if (!build.ok) fail(`Üye sitesi çıktısı denetimden GEÇMEDİ; hiçbir şey gönderilmedi.\n  - ${build.problems.join('\n  - ')}`)
if (build.commit !== run('git', ['rev-parse', '--short=7', 'HEAD'])) fail('Derlemedeki sürüm bilgisi HEAD ile aynı değil; hiçbir şey gönderilmedi.')
console.log(`✓ Çıktı denetimi geçti: ${build.files.length} dosya, ${build.totalBytes} bayt, sürüm ${build.commit}, paket sürümü ${build.payloadVersion}`)
// Derleme sonrası testler gerçek çıktı üzerinde de çalışır.
step('derleme çıktısı testleri', 'npx', ['vitest', 'run', 'src/member/build', 'src/services/member/hygiene'])

// 3) Geçici klasörde repoyu sıfırdan kur, tek commit, force-push
const work = mkdtempSync(join(tmpdir(), 'gollazim-uye-yayin-'))
const expected = ['.nojekyll', ...build.files.map((f) => f.path)].sort()
let commit
try {
  run('git', ['init', '-q'], work)
  run('git', ['checkout', '-q', '-b', 'main'], work)
  writeFileSync(join(work, '.nojekyll'), '')
  for (const file of build.files) {
    mkdirSync(dirname(join(work, file.path)), { recursive: true })
    copyFileSync(join(DIST, file.path), join(work, file.path))
  }
  run('git', ['add', '--', ...expected], work)
  const staged = run('git', ['ls-files'], work).split('\n').sort()
  if (staged.join('\n') !== expected.join('\n')) throw new Error(`gönderilecek dosyalar beklenenden farklı: ${staged.join(', ')}`)
  run('git', ['-c', 'user.name=GOLLAZIM üye sitesi', '-c', `user.email=${login}@users.noreply.github.com`, 'commit', '-q', '-m', `Üye sitesi ${build.commit}`], work)
  commit = run('git', ['rev-parse', 'HEAD'], work)
  try {
    // Kimlik bilgisi gh'den anlık alınır; adrese, ayara ya da diske yazılmaz.
    run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '--force', '--quiet', `https://github.com/${REPO}.git`, 'main:main'], work)
  } catch (error) {
    const reason = String(error.stderr ?? error.message).split('\n').filter((l) => /error|fatal|denied|not found/i.test(l)).slice(0, 2).join(' ')
    throw new Error(`gönderilemedi (${REPO}). ${reason || 'Repo var mı ve yazma yetkiniz var mı?'}`)
  }
} catch (error) {
  rmSync(work, { recursive: true, force: true })
  fail(`Yayın yapılamadı: ${error.message}\n  Canlıdaki üye sitesi DEĞİŞMEDİ.`)
}
rmSync(work, { recursive: true, force: true })

// 4) Repoda yalnızca beklenen dosyalar var mı
try {
  const tree = JSON.parse(run('gh', ['api', `repos/${REPO}/git/trees/${commit}?recursive=1`]))
  const paths = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path).sort()
  if (paths.join('\n') !== expected.join('\n')) fail(`Repoda beklenmeyen dosyalar var: ${paths.join(', ')}`)
  console.log(`✓ Gönderildi: ${REPO} (tek commit ${commit.slice(0, 8)}, ${paths.length} dosya)`)
} catch (error) {
  fail(`Gönderildi ama repo içeriği doğrulanamadı: ${String(error.message).split('\n')[0]}`)
}

// 5) Canlı doğrulama (Pages'in yeni sürümü sunmasını bekler)
const started = Date.now()
process.stdout.write('  Canlı site bekleniyor')
let different = ['henüz denetlenmedi']
while ((Date.now() - started) / 1000 < WAIT_SECONDS) {
  different = await compareLive(build.files)
  if (different.length === 0) break
  process.stdout.write('.')
  await sleep(4000)
}
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log('')
if (different.length > 0) fail(`Gönderildi ama ${seconds} sn içinde canlıda doğrulanamadı. GitHub Pages gecikmiş olabilir; birkaç dakika sonra \`npm run uye-yayinla -- --dogrula\` çalıştırın.\n  Farklı ya da eksik: ${different.join(', ')}`)
console.log(`✓ Canlıda: ${build.files.length} dosyanın özeti yereldekiyle aynı (${seconds} sn sonra)\n  ${SITE}\n  Sürüm: ${build.commit}`)
