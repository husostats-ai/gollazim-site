// Admin sayfasının sekmeleri ve her bölümün hangi sekmede durduğu. Yalnızca arayüz düzenidir:
// veri, analiz ve yayın mantığına dokunmaz.

export type AdminTabId = 'gunluk' | 'uyeler' | 'ai' | 'veri'

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: 'gunluk', label: 'GÜNLÜK' },
  { id: 'uyeler', label: 'ÜYELER' },
  { id: 'ai', label: 'AI ARAŞTIRMA' },
  { id: 'veri', label: 'VERİ-YEDEK' },
]

export const DEFAULT_ADMIN_TAB: AdminTabId = 'gunluk'
/** Açık sekme adreste tutulur: #/admin?sekme=uyeler */
export const ADMIN_TAB_PARAM = 'sekme'

export type AdminSectionId =
  | 'upload'
  | 'league'
  | 'highlights'
  | 'streak'
  | 'story'
  | 'publish'
  | 'members'
  | 'keyBackup'
  | 'memberTexts'
  | 'rawCompare'
  | 'backup'
  | 'matchEdit'
  | 'thresholds'
  | 'marketLimit'
  | 'storyTexts'

/** Bölümler, sayfada çizildikleri sırayla. Her bölüm tam bir sekmededir. */
export const ADMIN_SECTIONS: { id: AdminSectionId; tab: AdminTabId; title: string }[] = [
  { id: 'upload', tab: 'gunluk', title: 'CSV YÜKLE' },
  { id: 'league', tab: 'gunluk', title: 'LİG TABLOSU YAPIŞTIR' },
  { id: 'highlights', tab: 'gunluk', title: 'GÜNÜN ÖNE ÇIKANLARI' },
  { id: 'streak', tab: 'gunluk', title: 'SERİ TAKİBİ' },
  { id: 'story', tab: 'gunluk', title: 'GÖRSEL OLUŞTUR' },
  // Üç üye kartını tek bileşen çizer (ortak durum); bu yüzden art arda ve aynı sekmededir.
  { id: 'publish', tab: 'uyeler', title: 'ÜYE SAYFASI: YAYINLA' },
  { id: 'members', tab: 'uyeler', title: 'ÜYE SAYFASI: ÜYELER' },
  { id: 'keyBackup', tab: 'uyeler', title: 'ÜYE SAYFASI: ÜYE ANAHTAR YEDEĞİ' },
  { id: 'memberTexts', tab: 'uyeler', title: 'AYARLAR: ÜYE SAYFASI METİNLERİ' },
  { id: 'rawCompare', tab: 'ai', title: 'HAM VERİ KARŞILAŞTIRMA' },
  { id: 'backup', tab: 'veri', title: 'VERİ YEDEĞİ' },
  { id: 'matchEdit', tab: 'veri', title: 'MAÇLARI DÜZENLE' },
  { id: 'thresholds', tab: 'veri', title: 'EŞİK DEĞERLERİ' },
  { id: 'marketLimit', tab: 'veri', title: 'AYARLAR: PİYASA ÇELİŞKİSİ SINIRI' },
  { id: 'storyTexts', tab: 'veri', title: 'AYARLAR: GÖRSEL VE AÇIKLAMA METİNLERİ' },
]

/** Adresteki sekme değerini okur; boş ya da bilinmeyen değer GÜNLÜK sayılır. */
export const parseAdminTab = (value: string | null | undefined): AdminTabId => ADMIN_TABS.find((tab) => tab.id === value)?.id ?? DEFAULT_ADMIN_TAB

/** Sekmenin adresi; varsayılan sekme parametresiz /admin'dir. */
export const adminTabPath = (tab: AdminTabId): string => (tab === DEFAULT_ADMIN_TAB ? '/admin' : `/admin?${ADMIN_TAB_PARAM}=${tab}`)

export const sectionsOfTab = (tab: AdminTabId): AdminSectionId[] => ADMIN_SECTIONS.filter((section) => section.tab === tab).map((section) => section.id)

export interface AdminBadgeInput {
  /** Veri yedeğinin düzeyi (yedek hatırlatıcısındaki) */
  backupLevel: 'none' | 'ok' | 'warn' | 'alert' | 'never' | null
  /** Üye anahtar yedeğinin düzeyi */
  keyBackupLevel: string | null
  /** Üye sitesi bu sürümün paketini açabiliyor mu */
  siteLevel: 'ok' | 'older' | 'incompatible' | 'unknown' | null
  /** ÜYELER sekmesinde bakılması gereken bir şey açık: şifre kutusu ya da yayın hatası */
  memberAttention: boolean
}

/**
 * Sekme etiketindeki ⚠ rozetinin nedeni; rozet yoksa null. Gizli sekmedeki uyarı gözden
 * kaçmasın diye vardır. "Üye sitesi eski olabilir" (older) rozet yakmaz: yalnızca admin
 * yayınlandığında hep görünür ve yayını engellemez.
 */
export function adminTabBadges(input: AdminBadgeInput): Record<AdminTabId, string | null> {
  const members =
    input.siteLevel === 'incompatible'
      ? 'Üye sitesi bu sürümün paketini açamıyor'
      : input.memberAttention
        ? 'Bakılması gereken şifre kutusu ya da yayın hatası var'
        : input.keyBackupLevel !== null && input.keyBackupLevel !== 'none' && input.keyBackupLevel !== 'ok'
          ? 'Üye anahtar yedeği güncel değil'
          : null
  const data = input.backupLevel === 'warn' || input.backupLevel === 'alert' || input.backupLevel === 'never' ? 'Veri yedeği güncel değil' : null
  return { gunluk: null, uyeler: members, ai: null, veri: data }
}
