import type { ReliabilityLevel } from '../analysis/types'
import type { MemberConflict, MemberStanding } from './payload'

// Üye sayfasında gösterilen etiketler. Paket yalnızca türleri (seviye, çelişki türü)
// taşır; metinler burada üretilir. Admin ekranındaki etiketlerden bilerek ayrıdır:
// üyeye ham veriye ya da oranlara değinen metin gösterilmez.

export const MEMBER_RELIABILITY_LABELS: Record<ReliabilityLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  unknown: 'Bilinmiyor',
  unmeasured: 'Ölçülemedi',
  market: 'Model tabanlı',
  'market-partial': 'Model tabanlı (kısmi)',
}

export const MEMBER_CONFLICT_LABELS: Record<MemberConflict, string> = {
  model: 'Model çelişkisi',
  hesap: 'Hesaplar çelişiyor',
}

export const STALE_TABLE_LABEL = 'tablo güncel değil'

/** "3. sıra · 8 maç" */
export const standingText = (standing: MemberStanding): string => `${standing.rank}. sıra · ${standing.played} maç`
