import type { MemberTexts } from '../../config/memberTexts'

// Admin tarafındaki üye kayıtları. Bunlar yalnızca admin tarayıcısında durur; yayın
// paketine ve normal JSON yedeğine girmez (ayrı, parolayla şifreli üye anahtar yedeği vardır).

/** Bir üye. Şifre saklanmaz; yalnızca şifreden türetilmiş anahtarlar (base64) saklanır. */
export interface MemberRecord {
  /** Kullanıcı adı (birincil anahtar): yalnızca a-z 0-9 . _ - */
  username: string
  /** DEK sarma anahtarı; çıkarılan üyede null */
  kek: string | null
  /** Yuva kimliği anahtarı; çıkarılan üyede null */
  idKey: string | null
  active: boolean
  createdAt: string
  /** Şifrenin son yenilendiği an */
  renewedAt?: string
  /** Çıkarıldığı an */
  removedAt?: string
}

export interface MemberMeta {
  /** Sitenin tuzu (base64, 16 bayt); ilk üye oluşturulurken üretilir */
  siteSalt: string | null
  /** Son yayının numarası; hiç yayın yoksa 0 */
  publishCounter: number
  /** Üye sayfasının uyarı metinleri */
  texts: MemberTexts
  /** Üye anahtarlarının son değiştiği an (ekleme, çıkarma, şifre yenileme) */
  keysChangedAt: string | null
  /** Bu tarayıcıda son üye anahtar yedeğinin alındığı an */
  lastKeyBackupAt: string | null
}

/** Yayın geçmişi satırı; içerik tutulmaz */
export interface PublicationRecord {
  n: number
  publishedAt: string
  /** Seçilen gün (paket bu günü ve önerisi olan önceki 6 günü içerir) */
  day: string
  memberCount: number
  /** Şifreli paketin boyutu (bayt) */
  bytes: number
}

/** Üye anahtar yedeğinin içeriği */
export interface MemberSnapshot {
  members: MemberRecord[]
  siteSalt: string | null
  publishCounter: number
  texts: MemberTexts
  publications: PublicationRecord[]
}
