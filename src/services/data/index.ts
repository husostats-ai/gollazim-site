// Veri katmanının tek giriş noktası. Supabase'e geçerken sadece bu
// dosyadaki import'lar yeni uygulamalara çevrilir.
export { uploadsRepo } from './dexie/uploadsRepo'
export { matchesRepo } from './dexie/matchesRepo'
export { resultsRepo } from './dexie/resultsRepo'
export { picksRepo } from './dexie/picksRepo'
export { settingsRepo } from './dexie/settingsRepo'
export { backupRepo } from './dexie/backupRepo'
export { aiRepo } from './dexie/aiRepo'
export { storySelectionsRepo } from './dexie/storySelectionsRepo'
export { sharedRepo } from './dexie/sharedRepo'
export type * from './types'
