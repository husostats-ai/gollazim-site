/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages proje sitesi https://<kullanıcı>.github.io/<repo>/ altında
// yayınlanır; derlemede base yolu repo adıdır. Repo adı değişirse burası da
// değişmelidir. Geliştirmede (npm run dev) site kökten açılır; derleme ve
// önizleme (npm run preview) yayındaki gibi alt dizini kullanır.
const REPO_NAME = 'gollazim-site'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? `/${REPO_NAME}/` : '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
