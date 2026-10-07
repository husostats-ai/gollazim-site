// Şifreli üye yayın paketini yayın reposuna gönderir.
//
//   npm run yayinla -- <paket.json yolu>     paketi yayınlar
//   npm run yayinla -- --kaldir              yayındaki paketi kaldırır (üye sayfası "yayın yok" der)
//
// Yaptığı iş: dosyanın ŞİFRELİ bir yayın paketi olduğunu denetler (düz paket, veri yedeği
// ve anahtar yedeği reddedilir); geçici bir klasörde yayın reposunu SIFIRDAN kurar
// (geçmişsiz, tek commit; yalnızca paket.json ve .nojekyll), force-push eder; ardından
// dosyayı yayın adresinden çekip SHA-256 özetinin aynı olduğunu doğrular.
// Böylece repoda eski yayınlar görünür biçimde kalmaz.
//
// Kimlik: yalnızca mevcut `gh` oturumu kullanılır. Hiçbir anahtar dosyaya, repoya ya da
// ekrana yazılmaz. Site reposuna (bu repo) dokunmaz.
// Ayarlar (isteğe bağlı): YAYIN_REPO (hesap/repo), YAYIN_URL (paketin adresi), YAYIN_BEKLE_SN.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkPackageText, MAX_PACKAGE_BYTES } from './lib/paket-denetim.mjs'

const REPO = process.env.YAYIN_REPO ?? 'husostats-ai/gollazim-yayin'
const URL_ = process.env.YAYIN_URL ?? `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/paket.json`
const WAIT_SECONDS = Number(process.env.YAYIN_BEKLE_SN ?? 600)
const FILES = ['.nojekyll', 'paket.json']

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Komutu çalıştırır; çıktı ekrana yazılmaz (hata olursa yalnızca kısa nedeni gösterilir) */
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const args = process.argv.slice(2)
const remove = args.includes('--kaldir')
const input = args.find((a) => !a.startsWith('--'))
if (args.length !== 1 || (!remove && !input)) fail('Kullanım: npm run yayinla -- <paket.json yolu>   ya da   npm run yayinla -- --kaldir')

// 1) Dosya denetimi (ağa çıkmadan önce)
let content = null
if (!remove) {
  const path = resolve(input)
  let size
  try {
    size = statSync(path).size
  } catch {
    fail(`Dosya bulunamadı: ${path}`)
  }
  if (size > MAX_PACKAGE_BYTES) fail(`Dosya çok büyük (${size} bayt). Yayın paketi değil gibi görünüyor; hiçbir şey gönderilmedi.`)
  content = readFileSync(path)
  const checked = checkPackageText(content.toString('utf8'))
  if (!checked.ok) fail(`Bu dosya yayınlanamaz; hiçbir şey gönderilmedi.\n  - ${checked.problems.join('\n  - ')}`)
  console.log(`✓ Şifreli yayın paketi: yayın no ${checked.n}, ${checked.slots} yuva, ${checked.bytes} bayt`)
}

// 2) gh oturumu
let login
try {
  run('gh', ['auth', 'status'])
  login = run('gh', ['api', 'user', '-q', '.login'])
} catch {
  fail('GitHub oturumu yok ya da süresi dolmuş. Önce `gh auth login` çalıştırın; hiçbir şey gönderilmedi.')
}

// 3) Geçici klasörde repoyu sıfırdan kur, tek commit, force-push
const work = mkdtempSync(join(tmpdir(), 'gollazim-yayin-'))
let commit
try {
  run('git', ['init', '-q'], work)
  run('git', ['checkout', '-q', '-b', 'main'], work)
  writeFileSync(join(work, '.nojekyll'), '')
  if (content) writeFileSync(join(work, 'paket.json'), content)
  const expected = content ? FILES : ['.nojekyll']
  run('git', ['add', '--', ...expected], work)
  const staged = run('git', ['ls-files'], work).split('\n').sort()
  if (staged.join() !== expected.join()) throw new Error(`gönderilecek dosyalar beklenenden farklı: ${staged.join(', ')}`)
  // Kişisel e-posta herkese açık repoya yazılmasın diye GitHub'ın "noreply" adresi kullanılır.
  run('git', ['-c', 'user.name=GOLLAZIM yayın', '-c', `user.email=${login}@users.noreply.github.com`, 'commit', '-q', '-m', content ? 'Yayın' : 'Yayın kaldırıldı'], work)
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
  fail(`Yayın yapılamadı: ${error.message}\n  Yayındaki paket DEĞİŞMEDİ.`)
}
rmSync(work, { recursive: true, force: true })

// 4) Repoda yalnızca beklenen dosyalar var mı
try {
  const tree = JSON.parse(run('gh', ['api', `repos/${REPO}/git/trees/${commit}?recursive=1`]))
  const paths = tree.tree.map((t) => t.path).sort()
  const expected = content ? FILES : ['.nojekyll']
  if (paths.join() !== expected.join()) fail(`Repoda beklenmeyen dosyalar var: ${paths.join(', ')}`)
  console.log(`✓ Gönderildi: ${REPO} (tek commit ${commit.slice(0, 8)}; dosyalar: ${paths.join(', ')})`)
} catch (error) {
  fail(`Gönderildi ama repo içeriği doğrulanamadı: ${String(error.message).split('\n')[0]}`)
}

// 5) Yayın adresinden doğrulama (Pages'in yeni dosyayı sunmasını bekler)
const expectedHash = content ? sha256(content) : null
if (content) console.log(`  Adres : ${URL_}\n  Boyut : ${content.length} bayt\n  SHA-256: ${expectedHash}`)
const started = Date.now()
const fetchNow = async () => {
  try {
    const response = await fetch(`${URL_}?t=${Date.now()}`, { cache: 'no-store' })
    return { status: response.status, hash: response.ok ? sha256(Buffer.from(await response.arrayBuffer())) : null }
  } catch {
    return { status: 0, hash: null }
  }
}
process.stdout.write('  Yayın adresi bekleniyor')
let seen = null
while ((Date.now() - started) / 1000 < WAIT_SECONDS) {
  seen = await fetchNow()
  if (content ? seen.hash === expectedHash : seen.status === 404) break
  process.stdout.write('.')
  await sleep(3000)
}
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log('')
if (content ? seen?.hash !== expectedHash : seen?.status !== 404)
  fail(`Paket gönderildi ama ${seconds} sn içinde yayın adresinde görünmedi (son durum: HTTP ${seen?.status}). GitHub Pages gecikmiş olabilir; birkaç dakika sonra adresi denetleyin:\n  ${URL_}`)
console.log(content ? `✓ Yayında: adresten çekilen dosyanın özeti aynı (${seconds} sn sonra görüldü)` : `✓ Yayın kaldırıldı: adres artık "bulunamadı" veriyor (${seconds} sn sonra)`)
