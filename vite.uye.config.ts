import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// AYRI ÜYE SİTESİNİN derlemesi: https://husostats-ai.github.io/gollazim-uye/
// Giriş uye.html -> src/member/main.tsx; çıktıda yalnızca üye uygulaması bulunur.
// `npm run build:uye` ile derlenir, `npm run uye-yayinla` ile yayınlanır.
const REPO_NAME = 'gollazim-uye'

/** Derlemenin yapıldığı commit'in kısa kimliği; git yoksa 'bilinmiyor' */
function buildCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'bilinmiyor'
  } catch {
    return 'bilinmiyor'
  }
}

/** Üye sitesine kopyalanan statik dosyalar. Story görsellerinin kullandığı büyük logo.png buraya girmez. */
const STATIC_FILES = ['favicon.png', 'logo-256.png', 'robots.txt']

/** Üye uygulamasının açabildiği en yüksek paket sürümü (src/services/member/payload.ts ile aynı olmalı; testle denetlenir) */
export const MEMBER_SITE_PAYLOAD_VERSION = 2

const memberSite = (commit: string): Plugin => ({
  name: 'gollazim-uye-sitesi',
  // Sayfa çıktıya Vite'ın kendi eklentisiyle girer; ondan sonra çalışmalıdır.
  enforce: 'post',
  generateBundle(_, bundle) {
    // Sayfa, sitenin kökünde index.html olarak sunulur.
    const page = bundle['uye.html']
    if (!page) this.error('uye.html çıktıda bulunamadı')
    page.fileName = 'index.html'
    for (const name of STATIC_FILES) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(`public/${name}`) })
    // Sürüm bilgisi: Admin'in "Yayınla" ekranı üye sitesinin güncel olup olmadığını buradan okur.
    this.emitFile({ type: 'asset', fileName: 'surum.json', source: `${JSON.stringify({ commit, payloadVersion: MEMBER_SITE_PAYLOAD_VERSION })}\n` })
  },
})

export default defineConfig(() => {
  const commit = buildCommit()
  return {
    base: `/${REPO_NAME}/`,
    // public/ klasörü olduğu gibi kopyalanmaz; yalnızca yukarıdaki dosyalar eklenir.
    publicDir: false as const,
    define: { __APP_COMMIT__: JSON.stringify(commit) },
    plugins: [react(), tailwindcss(), memberSite(commit)],
    build: {
      outDir: 'dist-uye',
      emptyOutDir: true,
      rollupOptions: { input: 'uye.html' },
    },
  }
})
