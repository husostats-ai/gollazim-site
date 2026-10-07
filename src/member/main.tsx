import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import '../index.css'
import MemberApp from './MemberApp'

// AYRI ÜYE SİTESİNİN girişi (https://husostats-ai.github.io/gollazim-uye/). Bu derlemede
// yalnızca üye uygulaması vardır: admin sayfaları, uygulama durumu ve veri deposu yoktur.
// Üye uygulaması kökte çalışır; eski "#/uye" bağlantıları köke yönlenir.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/uye/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<MemberApp basePath="" />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
