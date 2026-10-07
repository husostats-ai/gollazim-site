// Üye sayfasının ayarları.

/**
 * Şifreli yayın paketinin adresi. VITE_UYE_PAKET_URL ile değiştirilir (derleme zamanı;
 * gizli bir değer değildir, paket şifrelidir). Verilmezse: geliştirmede yerelde üretilen
 * örnek paket (samples/ repoya girmez), yayında aynı alan adındaki ayrı yayın reposu.
 */
export const MEMBER_PACKAGE_URL: string =
  (import.meta.env?.VITE_UYE_PAKET_URL as string | undefined) || (import.meta.env?.DEV ? '/samples/uye/paket.json' : '/gollazim-yayin/paket.json')

/** Yayın bu kadar saatten eskiyse "Bu veri güncel olmayabilir" uyarısı çıkar */
export const MEMBER_STALE_HOURS = 12

/** Bu kadar saat hiçbir işlem yapılmazsa oturum kapanır */
export const MEMBER_IDLE_HOURS = 12

/** Açık sayfada yeni yayın bu aralıkla denetlenir (dakika) */
export const MEMBER_POLL_MINUTES = 5

/** Üyelere verilen giriş adresi (hesap bilgi mesajında yer alır) */
export const MEMBER_SITE_URL = 'https://husostats-ai.github.io/gollazim-site/#/uye'

/**
 * Ayrı üye sitesinin sürüm bilgisi (derlendiği commit ve açabildiği paket sürümü).
 * Admin'in "Yayınla" ekranı buradan okur; adres admin sitesiyle aynı alan adındadır.
 */
export const MEMBER_SITE_VERSION_URL = '/gollazim-uye/surum.json'
