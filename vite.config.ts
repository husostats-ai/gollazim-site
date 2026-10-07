/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'

// GitHub Pages proje sitesi https://<kullanıcı>.github.io/<repo>/ altında
// yayınlanır; derlemede base yolu repo adıdır. Repo adı değişirse burası da
// değişmelidir. Geliştirmede (npm run dev) site kökten açılır; derleme ve
// önizleme (npm run preview) yayındaki gibi alt dizini kullanır.
const REPO_NAME = 'gollazim-site'

/** Derlemenin yapıldığı commit'in kısa kimliği; git yoksa 'bilinmiyor' */
function buildCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'bilinmiyor'
  } catch {
    return 'bilinmiyor'
  }
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? `/${REPO_NAME}/` : '/',
  plugins: [react(), tailwindcss()],
  // Derlemenin commit'i: Admin'in "Yayınla" ekranı üye sitesinin sürümüyle karşılaştırır.
  define: { __APP_COMMIT__: JSON.stringify(buildCommit()) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
