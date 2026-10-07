import type { MemberMeta, MemberRecord } from './types'

// "Üye anahtar yedeği" hatırlatıcısı. Normal yedeğin hatırlatıcısından bağımsızdır:
// kendi son-yedek zamanını kullanır ve güne değil, üye anahtarlarının değişmesine bakar.

/**
 * none: üye yok, hatırlatma gerekmez. ok: yedek güncel. never: üye var ama hiç yedek
 * alınmamış. stale: son yedekten sonra üye eklendi/çıkarıldı ya da şifre yenilendi.
 */
export type KeyBackupLevel = 'none' | 'ok' | 'never' | 'stale'

export interface KeyBackupStatus {
  level: KeyBackupLevel
  text: string
}

export const KEY_BACKUP_LOSS_TEXT = 'Bu yedek kaybolursa ve tarayıcı verisi silinirse TÜM üyelerin şifreleri yeniden üretilip dağıtılır.'

export function keyBackupStatus(members: readonly MemberRecord[], meta: Pick<MemberMeta, 'keysChangedAt' | 'lastKeyBackupAt'>): KeyBackupStatus {
  if (members.length === 0) return { level: 'none', text: '' }
  if (!meta.lastKeyBackupAt) return { level: 'never', text: 'Üye anahtar yedeği hiç alınmadı.' }
  if (meta.keysChangedAt && new Date(meta.keysChangedAt).getTime() > new Date(meta.lastKeyBackupAt).getTime())
    return { level: 'stale', text: 'Üye anahtar yedeğin eskidi: son yedekten sonra üye eklendi, çıkarıldı ya da şifre yenilendi.' }
  return { level: 'ok', text: 'Üye anahtar yedeği güncel.' }
}
