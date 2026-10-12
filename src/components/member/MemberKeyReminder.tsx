import { Link } from 'react-router-dom'
import { adminTabPath } from '../../config/adminTabs'
import { KEY_BACKUP_LOSS_TEXT, keyBackupStatus } from '../../services/memberAdmin/reminder'
import { useMemberAdminData } from './useMemberAdmin'

/**
 * "Üye anahtar yedeği" hatırlatıcısı: üye eklenince, çıkarılınca ya da şifre yenilenince
 * yedeğin eskidiğini söyler. Normal yedek hatırlatıcısından bağımsızdır; üye yoksa ya da
 * yedek güncelse görünmez. Admin sayfasında her sekmede görünür; onOpen, ÜYELER sekmesindeki
 * yedek bölümünü açar. Başka sayfalarda (onOpen yok) aynı sekmeye bağlantı verir.
 */
export default function MemberKeyReminder({ onOpen }: { onOpen?: () => void }) {
  const data = useMemberAdminData()
  if (!data) return null
  const status = keyBackupStatus(data.members, data.meta)
  if (status.level === 'none' || status.level === 'ok') return null
  return (
    <div role="status" data-testid="member-key-reminder" data-level={status.level} className="mb-4 min-w-0 rounded-2xl border border-loss-line bg-loss-soft p-3 text-loss-text">
      <p className="text-sm font-bold">
        <span aria-hidden="true">⚠ </span>
        <span className="uppercase">Üye anahtar yedeği:</span> {status.text}
      </p>
      <p className="mt-1 text-xs text-white">{KEY_BACKUP_LOSS_TEXT}</p>
      <p className="mt-1 text-xs text-muted">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="text-left font-bold text-brand hover:underline" data-testid="member-key-reminder-open">
            ÜYELER sekmesindeki “Üye anahtar yedeği” bölümünü aç
          </button>
        ) : (
          <Link to={adminTabPath('uyeler')} className="font-bold text-brand hover:underline">
            Admin sayfasının ÜYELER sekmesindeki “Üye anahtar yedeği” bölümünden yedek al
          </Link>
        )}
      </p>
    </div>
  )
}
