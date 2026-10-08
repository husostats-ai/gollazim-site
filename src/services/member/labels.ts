import type { ReliabilityLevel } from '../analysis/types'
import type { MatchStatus, PickOutcome } from '../../types'
import type { MemberErrorKind, SignOutReason } from './controller'
import type { MemberAi, MemberAiProvider, MemberAiVote, MemberConflict, MemberStanding } from './payload'

// Üye sayfasında gösterilen etiketler. Paket yalnızca türleri (seviye, çelişki türü)
// taşır; metinler burada üretilir. Admin ekranındaki etiketlerden bilerek ayrıdır:
// üyeye ham veriye ya da oranlara değinen metin gösterilmez.

/** Rozetin adı: seviye, yüzdenin kaç maçlık veriye dayandığını anlatır (maçın sonucuna güveni değil) */
export const MEMBER_DATA_TERM = 'Geçmiş veri'

/** "en az 4 maç": sayı tahmini bir alt sınırdır, gerçekte daha fazla olabilir */
export const memberSampleText = (sample: number): string => `en az ${sample} maç`

export const MEMBER_RELIABILITY_LABELS: Record<ReliabilityLevel, string> = {
  low: 'Az',
  medium: 'Orta',
  high: 'Çok',
  unknown: 'Bilinmiyor',
  unmeasured: 'Ölçülemedi',
  market: 'Model tabanlı',
  'market-partial': 'Model tabanlı (kısmi)',
}

export const MEMBER_CONFLICT_LABELS: Record<MemberConflict, string> = {
  model: 'Model çelişkisi',
  hesap: 'Hesaplar çelişiyor',
}

/** "AI öneri güveni" satırı: üç yapay zekânın, maçın önerilerine duyduğu güven (maçın sonucu değil) */
export const MEMBER_AI_TITLE = 'AI öneri güveni'
export const MEMBER_AI_PROVIDER_LABELS: Record<MemberAiProvider, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }
export const MEMBER_AI_LEVEL_LABELS: Record<MemberAiVote['level'], string> = { strong: 'Güçlü', medium: 'Orta', weak: 'Zayıf' }
/** "3/3 · Orta", "2/3 · Güçlü": kaç yapay zekânın aynı seviyeyi verdiği; ortalama değildir */
export const memberAiSummary = (ai: MemberAi): string => `${ai.count}/${ai.votes.length} · ${MEMBER_AI_LEVEL_LABELS[ai.level]}`

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

/** "Günün öne çıkanları" kutusunun sabit metinleri (üye sayfası) */
export const MEMBER_HIGHLIGHT_TEXTS = {
  title: 'GÜNÜN ÖNE ÇIKANLARI',
  /** Başlığın yanındaki küçük not: bölüm deneme aşamasındadır */
  trial: 'deneme',
  note: 'Bu bir istatistik taramasıdır; bahis tavsiyesi değildir.',
} as const

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
