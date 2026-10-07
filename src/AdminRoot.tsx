import App from './App'
import { AppProvider } from './state/AppContext'

/** Uygulamanın üye sayfası dışındaki tamamı: uygulama durumu (tarayıcıdaki veri) ve sayfalar. */
export default function AdminRoot() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  )
}
