import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { hasMemberSession } from './services/member/sessionFlag'
import './index.css'

// Üye sayfası (#/uye) ile uygulamanın geri kalanı ayrı parçalar olarak yüklenir:
// üye sayfası uygulama durumunu (tarayıcıdaki veriyi) hiç açmaz, üyeler de CSV,
// analiz ve yönetim kodunu indirmez.
const AdminRoot = lazy(() => import('./AdminRoot'))
const MemberApp = lazy(() => import('./member/MemberApp'))

/** Üye oturumu açık sekmede diğer sayfalar üye sayfasına yönlenir. */
const Rest = () => (hasMemberSession() ? <Navigate to="/uye" replace /> : <AdminRoot />)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/uye/*" element={<MemberApp />} />
          <Route path="*" element={<Rest />} />
        </Routes>
      </Suspense>
    </HashRouter>
  </StrictMode>,
)
