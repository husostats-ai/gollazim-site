import App from './App'
import { ensurePersistence } from './services/data/backupFile'
import { AppProvider } from './state/AppContext'

// Açılışta kalıcı depo istenir (bir kez): tarayıcı veriyi depolama baskısında kendiliğinden silmesin.
void ensurePersistence()

/** Uygulamanın üye sayfası dışındaki tamamı: uygulama durumu (tarayıcıdaki veri) ve sayfalar. */
export default function AdminRoot() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  )
}
