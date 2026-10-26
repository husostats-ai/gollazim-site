import { HT05_NOTE_SINCE } from '../../config/categories'
import { formatPlainDate } from '../../utils/format'
import type { ReliabilityLevel } from '../analysis/types'
import type { MatchStatus, PickOutcome } from '../../types'
import type { MemberErrorKind, SignOutReason } from './controller'
import type { MemberAi, MemberAiProvider, MemberAiVote, MemberConflict, MemberStanding, MemberStreakState } from './payload'

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

/**
 * Kartın piyasa yüzdesi satırının etiketi ("Piyasa %54") ve "?" ile açılan notu. Bu iki metin üye sitesinde
 * "piyasa" geçebilen TEK yerdir: derleme denetimi (scripts/lib/uye-cikti-denetim.mjs) yalnızca bunları birebir
 * tanır; değiştirilirse orada da değiştirilmelidir (testle denetlenir).
 */
export const MEMBER_MARKET_LABEL = 'Piyasa'
export const MEMBER_MARKET_NOTE = 'Maç öncesi piyasa fiyatlamasından hesaplanan olasılık; bilgi amaçlıdır. Kartın büyük yüzdesinden ayrı bir ölçüdür.'
/** "?" düğmesinin ekran okuyucu adı */
export const MEMBER_MARKET_NOTE_BUTTON = 'Açıklama'

/** Maç kartındaki admin notunun satır başlığı (nötr etiket) ve görsel düğmelerinin ekran okuyucu adları */
export const MEMBER_NOTE_LABEL = 'Not'
export const MEMBER_NOTE_IMAGE_OPEN = 'Görseli büyüt'
export const MEMBER_NOTE_IMAGE_ALT = 'Not görseli'
export const MEMBER_NOTE_IMAGE_CLOSE = 'Kapat'

export const MEMBER_CONFLICT_LABELS: Record<MemberConflict, string> = {
  model: 'Model çelişkisi',
  hesap: 'Hesaplar çelişiyor',
}

/** "AI öneri güveni" satırı: üç yapay zekânın, kartın kendi kategorisindeki öneriye duyduğu güven (maçın sonucu değil) */
export const MEMBER_AI_TITLE = 'AI öneri güveni'
/** Kategori adı başlıkta küçük harfle yazılır: "2.5 ÜST & KG VAR" -> "2.5 Üst & KG Var" */
const titleCase = (label: string): string =>
  label
    .split(' ')
    .map((word) => (word === 'KG' ? word : word.charAt(0).toLocaleUpperCase('tr') + word.slice(1).toLocaleLowerCase('tr')))
    .join(' ')
/** "AI öneri güveni (2.5 Üst)": satır yalnızca bu kategoriye aittir */
export const memberAiTitle = (categoryLabel: string): string => `${MEMBER_AI_TITLE} (${titleCase(categoryLabel)})`
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

/** "Seri takibi" sayfasının sabit metinleri (üye sayfası). Gözlem dilidir: yalnızca adım, seri ve sonuç sözcükleri. */
export const MEMBER_STREAK_TEXTS = {
  tab: 'SERİ TAKİBİ',
  title: 'Seri Takibi',
  /** Başlığın yanındaki küçük not: bölüm deneme aşamasındadır */
  trial: 'deneme',
  intro: 'Sırayla izlenen maçların sonuçları. Tutan her maç seriyi bir adım ilerletir; tutmayan maç seriyi bitirir. Oynanmayan ya da değerlendirilemeyen maç seriyi etkilemez.',
  active: 'AKTİF SERİ',
  empty: 'Henüz seri yok.',
  noActive: 'Şu an aktif seri yok.',
  past: 'GEÇMİŞ SERİLER',
  noPast: 'Biten seri yok.',
  longest: 'En uzun seri',
  current: 'Mevcut seri',
  count: 'Toplam seri',
  mean: 'Seri başına tutan (ort.)',
  won: 'Tuttu',
  lost: 'Tutmadı',
  lowSample: '⚠ az örnek',
  lowSampleNote: (limit: number) => `${limit}’den az biten seri var; sayılar tesadüfen yüksek ya da düşük çıkmış olabilir.`,
  step: (step: number) => `${step}. adım`,
  runLength: (length: number) => `${length} adım tuttu`,
  runEnded: 'Seriyi bitiren maç',
  note: 'İstatistik takibidir, bahis tavsiyesi değildir. 18+',
} as const

/**
 * İY 0.5 ÜST (*) notunu sağlayan maçlardan ilk yarısı 0-0 bitenler kutusunun metinleri. Yalnızca geçmiş maçların
 * sayımını anlatır; ileriye dönük bir ifade içermez. Tarih tek sabitten (HT05_NOTE_SINCE) yazılır.
 */
export const MEMBER_HT05_NOTE_TEXT = {
  title: 'UYARI (*) NOTLU MAÇLARDA 2. YARI',
  intro: 'İLK YARI 0.5 ÜST, 2.5 ÜST ve 2. YARI 0.5 ÜST önerisi birlikte olan maçlardan ilk yarısı 0-0 bitenler.',
  empty: 'Henüz maç yok.',
  matches: (n: number) => `İlk yarısı 0-0 biten ${n} maç`,
  over: '2. yarıda en az 2 gol oldu',
  under: 'olmadı',
  lowData: 'az veri',
  lowSample: '⚠ az örnek',
  lowSampleNote: 'Maç sayısı az; bu yüzde tesadüfen yüksek ya da düşük çıkmış olabilir.',
  note: 'Geçmiş maçların sayımıdır; ölçümdür, tavsiye değildir.',
  since: `Uyarı koşulu geçmiş maçlara da uygulandı; kartta not ${formatPlainDate(HT05_NOTE_SINCE)}'dan itibaren görünüyor.`,
} as const

/** Seri adımının durumu: işaretler sonuç rozetleriyle aynıdır */
export const MEMBER_STREAK_STATES: Record<MemberStreakState, { mark: string; label: string }> = {
  won: { mark: '✓', label: 'Tuttu' },
  lost: { mark: '✗', label: 'Tutmadı' },
  pending: { mark: '···', label: 'Bekliyor' },
  unplayed: { mark: '—', label: 'Oynanmadı' },
  void: { mark: '—', label: 'Değerlendirilemedi' },
  withdrawn: { mark: '—', label: 'Geri çekildi' },
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
