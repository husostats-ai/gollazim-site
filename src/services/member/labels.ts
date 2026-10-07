import type { ReliabilityLevel } from '../analysis/types'
import type { MatchStatus, PickOutcome } from '../../types'
import type { MemberErrorKind, SignOutReason } from './controller'
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

export const STALE_TABLE_LABEL = '⚠ tablo eski'

/** "3. sıra · 8 maç" */
export const standingText = (standing: MemberStanding): string => `${standing.rank}. sıra · ${standing.played} maç`

/** Sonuç işaretleri sonuç görselindekiyle aynıdır: tuttu ✓, tutmadı ✗, değerlendirilemedi —, bekliyor ··· */
export const MEMBER_OUTCOMES: Record<PickOutcome, { mark: string; label: string }> = {
  won: { mark: '✓', label: 'Tuttu' },
  lost: { mark: '✗', label: 'Tutmadı' },
  void: { mark: '—', label: 'Değerlendirilemedi' },
  pending: { mark: '···', label: 'Bekliyor' },
}

/** Skoru olmayan maç durumlarının etiketi; tamamlanan maçta skor gösterilir */
export const MEMBER_STATUS_LABELS: Record<MatchStatus, string | null> = {
  pending: 'Devam ediyor / bekliyor',
  completed: null,
  postponed: 'Ertelendi',
  cancelled: 'İptal',
}

/** Giriş öncesi gösterilen sabit uyarılar; giriş sonrası metinler paketten gelir */
export const MEMBER_ERROR_TEXTS: Record<MemberErrorKind, string> = {
  credentials: 'Kullanıcı adı veya şifre hatalı.',
  network: 'Yayına ulaşılamadı. İnternetinizi kontrol edip yeniden deneyin.',
  missing: 'Henüz yayınlanmış bir analiz yok. Daha sonra yeniden deneyin.',
  invalid: 'Yayın dosyası okunamadı. Sayfayı yenileyip yeniden deneyin.',
  outdated: 'Bu sayfa eski bir sürümde kalmış. Sayfayı yenileyin.',
  corrupt: 'Yayın açılamadı: dosya eksik inmiş ya da bozulmuş olabilir. Sayfayı yenileyip yeniden deneyin.',
  unsupported: 'Bu tarayıcıda sayfa açılamıyor. Güncel bir tarayıcıyla ve https adresinden deneyin.',
}

export const MEMBER_NOTICE_TEXTS: Record<SignOutReason, string> = {
  expired: 'Uzun süre işlem yapılmadığı için oturum kapandı. Yeniden giriş yapın.',
  revoked: 'Bu hesabın erişimi sona ermiş.',
}

export const STALE_DATA_TEXT = 'Bu veri güncel olmayabilir.'
