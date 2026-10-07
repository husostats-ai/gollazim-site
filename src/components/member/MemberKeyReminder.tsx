import { Link } from 'react-router-dom'
import { KEY_BACKUP_LOSS_TEXT, keyBackupStatus } from '../../services/memberAdmin/reminder'
import { useMemberAdminData } from './useMemberAdmin'

/**
 * "Üye anahtar yedeği" hatırlatıcısı: üye eklenince, çıkarılınca ya da şifre yenilenince
 * yedeğin eskidiğini söyler. Normal yedek hatırlatıcısından bağımsızdır; üye yoksa ya da
 * yedek güncelse görünmez.
 */
export default function MemberKeyReminder({ linkToAdmin = false }: { linkToAdmin?: boolean }) {
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
        {linkToAdmin ? (
          <Link to="/admin" className="font-bold text-brand hover:underline">
            Admin sayfasındaki “Üye anahtar yedeği” bölümünden yedek al
          </Link>
        ) : (
          'Aşağıdaki “Üye anahtar yedeği” bölümünden yedek al.'
        )}
      </p>
    </div>
  )
}
