// AYRI ÜYE SİTESİNİN derleme çıktısını (dist-uye) denetler. Yayın komutu (scripts/uye-yayinla.mjs)
// çıktıyı göndermeden önce buradan geçirir; aynı denetim testlerde de çalışır.
//
// Denetlenenler: dosya listesi izinli kümeyle birebir aynı; çıktıda veri deposu, CSV okuyucu,
// admin sayfaları, paket şifreleme / şifre üretme kodu ve ham veri izi yok; gizli anahtar,
// yedek ya da paket yok; üye sayfasında yasak terimler yok; sayfa noindex ve doğru başlıkta.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const MEMBER_SITE_BASE = '/gollazim-uye/'

/** Kökte bulunabilecek dosyalar (birebir) ve assets/ altındaki dosya adı kalıpları */
const ROOT_FILES = ['favicon.png', 'index.html', 'logo-256.png', 'robots.txt', 'surum.json']
const ASSET_PATTERNS = [/^assets\/uye-[A-Za-z0-9_-]+\.js$/, /^assets\/uye-[A-Za-z0-9_-]+\.css$/, /^assets\/inter-latin(-ext)?-wght-normal-[A-Za-z0-9_-]+\.woff2$/]
const TEXT = /\.(html|js|css|json|txt)$/

// Desenler parça parça yazılır ki bu dosyanın kendisi (ve onu içe aktaran testler) eşleşmesin.
/** Üye sitesinde bulunmaması gereken kod ve metin izleri */
const FORBIDDEN = [
  ['veri deposu kitaplığı', new RegExp('dex' + 'ie', 'i')],
  ['tarayıcı veritabanı', new RegExp('indexed' + 'db', 'i')],
  ['kalıcı tarayıcı deposu', new RegExp('local' + 'Storage')],
  ['CSV okuyucu', new RegExp('papa' + 'parse|Papa\\.' + 'parse', 'i')],
  ['uygulamanın admin parçası', new RegExp('Admin' + 'Root|App' + 'Provider')],
  // Paket ŞİFRELEME ve şifre ÜRETME tarafı (çözme tarafındaki unwrapKey / decrypt serbesttir)
  ['paket şifreleme kodu', new RegExp('(?<!un)wrap' + 'Key|generate' + 'Key|["\'`]enc' + 'rypt["\'`]|\\.enc' + 'rypt\\(')],
  ['şifre üretme kodu', new RegExp('getRandom' + 'Values')],
  ['analiz motoru', new RegExp('analyze' + 'Day|goalModel' + 'Percent|buildSideGoals' + 'Model')],
  ['ham veri alanı', new RegExp('Odds' + '_|odds' + 'Home|Pre-Match' + ' xG|Footy' + 'Stats|home' + 'Xg|avg' + 'Goals')],
  ['admin kaydı alanı', new RegExp('ai' + 'Verdicts|score' + 'Snapshot|shared' + 'Picks|team' + 'Aliases')],
  ['admin sayfası metni', new RegExp('SKOR Gİ' + 'RİŞİ|AI ANA' + 'LİZİ|Veriyi dışa' + ' aktar|CSV yük' + 'le|ÜYE SAYFASI: ÜYE' + 'LER|Dağıtım list' + 'esi|Şifreyi yen' + 'ile|Üye anahtar yed' + 'eği')],
  ['admin sayfası öğesi', new RegExp('csv-in' + 'put|publish-con' + 'firm|member-add-user' + 'name|keybackup-' + 'pass|score-fo' + 'rm')],
  ['admin sitesinin adresi', new RegExp('gollazim-si' + 'te')],
  ['özel anahtar', new RegExp('-----BEGIN [A-Z ]*PRIVATE' + ' KEY-----')],
  ['gizli servis anahtarı', new RegExp('service' + '_role|sb_' + 'secret_|eyJhbGciOi' + '[A-Za-z0-9_-]{20,}')],
  ['GitHub erişim anahtarı', new RegExp('gh[pousr]_' + '[A-Za-z0-9]{30,}|github_pat_' + '[A-Za-z0-9_]{30,}')],
  ['ham CSV satırı (maç bağlantısı)', new RegExp('/[a-z0-9-]+/[a-z0-9-]+-vs-[a-z0-9-]+-h2h-' + 'stats')],
  ['yayın paketi ya da anahtar yedeği dosyası', new RegExp('"format"\\s*:\\s*"gollazim-' + 'uye-')],
  ['JSON yedek', new RegExp('"app"\\s*:\\s*"gollazim"\\s*,\\s*"version"')],
]

/** Üye sayfasında hiçbir biçimde geçmemesi gereken terimler (küçük harfe çevrilmiş metinde aranır) */
const FORBIDDEN_WORDS = ['oran', 'piyasa', 'kaynak', 'ortalama', 'bağlantı', 'footystats', 'csv', 'odds']
/** Kısa olduğu için yalnızca sözcük olarak aranan terimler (küçültülmüş kodda rastgele harf dizisi olarak geçebilir) */
const FORBIDDEN_WHOLE_WORDS = ['xg']
const WORD_CHAR = 'a-zçğıöşü0-9_'

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function listFiles(dir, prefix = '') {
  return readdirSync(join(dir, prefix)).flatMap((name) => {
    const path = prefix ? `${prefix}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? listFiles(dir, path) : [path]
  })
}

/**
 * Çıktı klasörünü denetler. { ok, problems, files: [{ path, bytes, sha256 }], totalBytes, commit, payloadVersion }
 */
export function checkMemberBuild(dir) {
  const problems = []
  if (!existsSync(dir)) return { ok: false, problems: [`çıktı klasörü yok: ${dir}`], files: [], totalBytes: 0, commit: null, payloadVersion: null }
  const paths = listFiles(dir).sort()

  // 1) Dosya listesi izinli kümeyle birebir aynı
  const unexpected = paths.filter((p) => !ROOT_FILES.includes(p) && !ASSET_PATTERNS.some((pattern) => pattern.test(p)))
  if (unexpected.length > 0) problems.push(`izinli olmayan dosya: ${unexpected.join(', ')}`)
  const missing = ROOT_FILES.filter((p) => !paths.includes(p))
  if (missing.length > 0) problems.push(`eksik dosya: ${missing.join(', ')}`)
  for (const [kind, pattern, count] of [['JS', ASSET_PATTERNS[0], 1], ['CSS', ASSET_PATTERNS[1], 1], ['yazı tipi', ASSET_PATTERNS[2], 2]]) {
    const found = paths.filter((p) => pattern.test(p)).length
    if (found !== count) problems.push(`${kind} dosyası sayısı ${found} (beklenen ${count})`)
  }

  const files = paths.map((path) => {
    const content = readFileSync(join(dir, path))
    return { path, bytes: content.length, sha256: sha256(content), content }
  })

  // 2) Yasak izler ve terimler
  for (const file of files.filter((f) => TEXT.test(f.path))) {
    const text = file.content.toString('utf8')
    for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) problems.push(`${file.path}: ${name}`)
    const lower = text.toLocaleLowerCase('tr')
    for (const word of FORBIDDEN_WORDS) if (lower.includes(word)) problems.push(`${file.path}: yasak terim "${word}"`)
    for (const word of FORBIDDEN_WHOLE_WORDS) if (new RegExp(`(^|[^${WORD_CHAR}])${word}([^${WORD_CHAR}]|$)`).test(lower)) problems.push(`${file.path}: yasak terim "${word}"`)
  }

  // 3) Sayfa: noindex, başlık, simge, doğru taban yol
  const page = files.find((f) => f.path === 'index.html')?.content.toString('utf8') ?? ''
  if (!/<meta name="robots" content="noindex, nofollow, noarchive"/.test(page)) problems.push('index.html: noindex etiketi yok')
  if (!/<title>GOLLAZIM<\/title>/.test(page)) problems.push('index.html: başlık beklenenden farklı')
  if (!/<link rel="icon" type="image\/png" href="\.\/favicon\.png"/.test(page)) problems.push('index.html: simge bağlantısı yok')
  const references = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const outside = references.filter((r) => !r.startsWith(`${MEMBER_SITE_BASE}assets/`) && r !== './favicon.png')
  if (outside.length > 0) problems.push(`index.html: beklenmeyen adres: ${outside.join(', ')}`)
  for (const reference of references.filter((r) => r.startsWith(MEMBER_SITE_BASE))) if (!paths.includes(reference.slice(MEMBER_SITE_BASE.length))) problems.push(`index.html: çıktıda olmayan dosyaya işaret ediyor: ${reference}`)
  if (/https?:\/\//.test(page)) problems.push('index.html: dış adres içeriyor')

  // 4) Sürüm bilgisi
  let commit = null
  let payloadVersion = null
  try {
    const version = JSON.parse(files.find((f) => f.path === 'surum.json').content.toString('utf8'))
    if (Object.keys(version).sort().join() !== 'commit,payloadVersion') throw new Error('alanlar')
    if (typeof version.commit !== 'string' || !/^([0-9a-f]{7}|bilinmiyor)$/.test(version.commit)) throw new Error('commit')
    if (!Number.isInteger(version.payloadVersion) || version.payloadVersion < 1) throw new Error('paket sürümü')
    commit = version.commit
    payloadVersion = version.payloadVersion
  } catch (error) {
    problems.push(`surum.json geçersiz (${error.message})`)
  }

  return { ok: problems.length === 0, problems, files: files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })), totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), commit, payloadVersion }
}
