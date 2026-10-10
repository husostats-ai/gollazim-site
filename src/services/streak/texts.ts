import type { StepState, StreakRefusal } from './streak'

// "Seri takibi" bölümünün admin sitesindeki metinleri. Gözlem dilidir: yalnızca adım, seri ve
// sonuç sözcükleri kullanılır (bkz. texts.test.ts; yasak sözcükler orada denetlenir).

export const STREAK_TITLE = 'SERİ TAKİBİ'

export const STREAK_NOTE = 'İstatistik takibidir, bahis tavsiyesi değildir. 18+'

export const STREAK_STATE_LABELS: Record<StepState, string> = {
  won: 'Tuttu',
  lost: 'Tutmadı',
  pending: 'Bekliyor',
  unplayed: 'Oynanmadı',
  void: 'Değerlendirilemedi',
}

export const STREAK_REFUSAL_TEXTS: Record<StreakRefusal, string> = {
  blocked: 'Önceki adım sonuçlanmadı.',
  locked: 'Maç başladı; adım kilitli.',
  published: 'Bu adım üyelere yayınlandı; silinemez.',
  'no-time': 'Maçın saati bilinmiyor; seriye gönderilemez.',
  exists: 'Bu öneri zaten seride yer aldı.',
  missing: 'Bu adım seride değil.',
  'not-pending': 'Yalnızca bekleyen adım kaldırılabilir.',
  played: 'Bu adım kaldırılamaz: önce Skor Girişi’nde maçı “Ertelendi” ya da “İptal” olarak işaretleyin.',
  'not-removed': 'Bu adım kaldırılmamış.',
  'not-last': 'Yalnızca son adımın kaldırılması geri alınabilir.',
  'removal-published': 'Kaldırma üyelere yayınlandı; geri alınamaz.',
}

export const STREAK_BUTTON_TEXTS = {
  add: '＋ Seriye gönder',
  addTitle: 'Seri takibine yeni adım olarak gönder',
  inSeries: (step: number | null) => (step === null ? '✓ Seride' : `✓ Seride · adım ${step}`),
  inSeriesTitle: 'Seriden geri al (adım silinir)',
  lockedIn: '🔒 Seride',
  blocked: '🔒 Önceki adım sonuçlanmadı',
  locked: '🔒 Kilitli',
  lockedTitle: 'Maç başladı; seriye gönderilemez.',
  noTime: 'saat bilinmiyor',
  used: 'Seride yer aldı',
} as const

export const STREAK_PANEL_TEXTS = {
  intro:
    'Kartlardaki “Seriye gönder” ile sırayla gönderilen öneriler. Aynı anda yalnızca bir bekleyen adım olabilir. Sonuç, skor girilince kendiliğinden gelir: tuttuysa seri bir adım ilerler, tutmadıysa seri biter. Maç başlayınca ve adım üyelere yayınlanınca adım kilitlenir.',
  empty: 'Henüz seriye gönderilen adım yok.',
  active: 'AKTİF SERİ',
  noActive: 'Aktif seri yok. Bir sonraki gönderim yeni seriyi başlatır.',
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
  remove: 'Bekleyen adımı kaldır (oynanmadı)',
  removeVoid: 'Bekleyen adımı kaldır (değerlendirilemedi)',
  removeConfirm: 'Bu adım seriden kaldırılacak. Seri bozulmaz; adım kayıtta “Oynanmadı” olarak kalır. Emin misiniz?',
  removeVoidConfirm: 'Bu adım seriden kaldırılacak. Seri bozulmaz; adım kayıtta “Değerlendirilemedi” olarak kalır. Emin misiniz?',
  removeHint: 'Maç oynanmayacaksa: Skor Girişi’nde “Ertelendi” ya da “İptal” olarak işaretleyin; ardından adım buradan kaldırılabilir.',
  voidHint: 'Maç tamamlandı ama bu kategori için gereken veri girilmedi. Veriyi Skor Girişi’nde girin ya da adımı kaldırın.',
  delete: 'Geri al',
  undo: 'Kaldırmayı geri al',
  revised: 'düzeltildi',
  revisedTitle: 'Bu adımın sonucu, skor düzeltildiği için sonradan değişti; seriler yeniden hesaplandı.',
  matchMissing: 'maç verisi silinmiş; kayıttan gösteriliyor',
  runLength: (length: number) => `${length} adım tuttu`,
  runEnded: 'Seriyi bitiren maç',
} as const
