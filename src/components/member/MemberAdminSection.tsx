import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { MEMBER_SITE_URL, MEMBER_SITE_VERSION_URL } from '../../config/member'
import { memberAdminRepo } from '../../services/data'
import { addMembers, backupMemberKeys, previewPublication, publish, removeMemberByName, renewMemberPassword, restoreMemberKeys } from '../../services/memberAdmin/actions'
import { checkPassphrase, PASSPHRASE_MIN_LENGTH } from '../../services/memberAdmin/keyBackup'
import { PUBLICATION_FILE_NAME, summarizePayload, type Publication, type PublishSummary } from '../../services/memberAdmin/publish'
import { accountMessage, activeMembers, checkNewUsername, distributionCsv, distributionFileName, parseBulkUsernames, USERNAME_PROBLEM_TEXTS, type IssuedLogin } from '../../services/memberAdmin/registry'
import { MEMBER_PAYLOAD_VERSION } from '../../services/member/payload'
import { KEY_BACKUP_LOSS_TEXT, keyBackupStatus } from '../../services/memberAdmin/reminder'
import { fetchSiteVersion, MEMBER_SITE_UPDATE_HINT, siteVersionStatus, type SiteVersionStatus } from '../../services/memberAdmin/siteVersion'
import { useApp } from '../../state/AppContext'
import { copyText } from '../../utils/clipboard'
import { toAppDateTime } from '../../utils/date'
import { formatDay, formatPlainDate } from '../../utils/format'
import { downloadText, notifyMemberAdminChanged, publishSources, useMemberAdminData, type MemberAdminData } from './useMemberAdmin'

// Admin sayfasının "ÜYE SAYFASI" bölümü: üye yönetimi, yayın ve üye anahtar yedeği.
// Düz şifreler yalnızca bu bileşenin belleğinde, üretildikleri ekran kapanana dek durur.

const PRIMARY = 'rounded-xl bg-brand px-4 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY = 'rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'
const SMALL = 'rounded-lg border border-navy-500 px-2.5 py-1.5 text-xs font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'
const INPUT = 'block w-full min-w-0 rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-60'

const kilobytes = (bytes: number): string => `${(bytes / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} KB`
const stamp = (iso: string): string => {
  const at = toAppDateTime(new Date(iso))
  return `${formatDay(at.date)} ${at.time}`
}
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.')

function Card({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid={testId}>
      <h2 className="font-extrabold tracking-wide">{title}</h2>
      {children}
    </section>
  )
}

/** Bir kez gösterilen giriş bilgileri */
export interface Issued {
  logins: IssuedLogin[]
  /** renew: şifre yenilendi, yeniden yayın gerekir */
  kind: 'new' | 'renew'
  /** Dağıtım listesi indirildi mi (yalnızca bir kez indirilir) */
  downloaded: boolean
}

export function IssuedBox({ issued, data, onClose, onDownloaded, onRepublish, busy }: { issued: Issued; data: MemberAdminData; onClose: () => void; onDownloaded: () => void; onRepublish: () => void; busy: boolean }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (key: string, text: string) => setCopied((await copyText(text)) ? key : null)
  return (
    <div className="mt-4 rounded-xl border border-warn-line bg-warn-soft p-3" data-testid="member-issued">
      <p className="text-base font-extrabold text-warn">⚠ ŞİFRELER YALNIZCA ŞİMDİ GÖRÜNÜR</p>
      <p className="mt-1 text-sm text-white">Şifreler hiçbir yere kaydedilmedi. Bu kutuyu kapatınca bir daha gösterilemez; kaybolan şifre için “Şifreyi yenile” kullanılır.</p>
      <ul className="mt-3 space-y-2">
        {issued.logins.map((login) => (
          <li key={login.username} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-navy-800 px-3 py-2" data-testid={`member-issued-${login.username}`}>
            <span className="font-bold">{login.username}</span>
            <code className="font-mono text-base font-bold tracking-wide text-brand select-all" data-testid="member-issued-password">
              {login.password}
            </code>
            <span className="ml-auto flex flex-wrap gap-1.5">
              <button type="button" className={SMALL} onClick={() => void copy(`p:${login.username}`, login.password)}>
                {copied === `p:${login.username}` ? 'Kopyalandı' : 'Şifreyi kopyala'}
              </button>
              <button type="button" className={SMALL} data-testid="member-issued-message" onClick={() => void copy(`m:${login.username}`, accountMessage(login, data.meta.texts, MEMBER_SITE_URL))}>
                {copied === `m:${login.username}` ? 'Kopyalandı' : 'Hesap mesajını kopyala'}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {issued.logins.length > 1 && (
        <div className="mt-3 rounded-lg border border-loss-line bg-loss-soft p-3">
          <p className="text-base font-extrabold text-loss-text">BU DOSYA ŞİFRE İÇERİR</p>
          <p className="mt-1 text-sm text-white">Dağıtım listesi (CSV: kullanıcı adı;şifre) yalnızca bir kez indirilebilir. Şifreleri üyelere ilettikten sonra dosyayı SİLİN; buluta, e-postaya ya da repoya koymayın.</p>
          <button
            type="button"
            className={`${PRIMARY} mt-2`}
            disabled={issued.downloaded}
            data-testid="member-distribution-download"
            onClick={() => {
              downloadText(distributionFileName(toAppDateTime(new Date()).date), distributionCsv(issued.logins), 'text/csv;charset=utf-8')
              onDownloaded()
            }}
          >
            {issued.downloaded ? 'Dağıtım listesi indirildi' : 'Dağıtım listesini indir (CSV)'}
          </button>
        </div>
      )}

      {issued.kind === 'renew' && (
        <p className="mt-3 text-sm text-white" data-testid="member-renew-note">
          Eski şifre, yeniden yayınlanana dek yayındaki paketi açmaya devam eder.{' '}
          <button type="button" className={`${SMALL} text-brand`} onClick={onRepublish} disabled={busy} data-testid="member-republish-now">
            Şimdi yeniden yayınla
          </button>
        </p>
      )}
      <button type="button" className={`${SECONDARY} mt-3`} onClick={onClose} data-testid="member-issued-close">
        Şifreleri ilettim, kapat
      </button>
    </div>
  )
}

export default function MemberAdminSection() {
  const data = useMemberAdminData()
  const { dates, today, selectedDate, dataVersion, highlights, aiVerdicts, refresh } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [username, setUsername] = useState('')
  const [bulk, setBulk] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const [day, setDay] = useState<string | null>(null)
  const [summary, setSummary] = useState<PublishSummary | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [published, setPublished] = useState<Publication | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [restorePass, setRestorePass] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [keyStatus, setKeyStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Ayrı üye sitesinin sürümü ile bu sürümün karşılaştırması; okunana dek null */
  const [siteStatus, setSiteStatus] = useState<SiteVersionStatus | null>(null)

  // Üye sitesi ayrı yayınlanır ve eski kalabilir: sürümü aynı alan adındaki adresinden okunur.
  useEffect(() => {
    let cancelled = false
    void fetchSiteVersion(MEMBER_SITE_VERSION_URL, (url, init) => fetch(url, init), Date.now()).then((site) => {
      if (!cancelled) setSiteStatus(siteVersionStatus(site, { commit: __APP_COMMIT__, payloadVersion: MEMBER_PAYLOAD_VERSION }))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Varsayılan gün: bugün (verisi varsa), yoksa seçili gün, o da yoksa en yeni gün.
  const publishDay = day && dates.includes(day) ? day : dates.includes(today) ? today : (selectedDate ?? dates[0] ?? null)
  const activeCount = data ? activeMembers(data.members).length : 0
  const version = data ? `${data.meta.publishCounter}:${data.meta.texts.disclaimer}:${data.meta.texts.account}` : ''

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    if (!publishDay) return
    void previewPublication(memberAdminRepo, publishSources, publishDay, new Date().toISOString()).then(
      (draft) => !cancelled && setSummary(summarizePayload(draft.payload)),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
    // Öne çıkan seçimler değişince de özet yenilenir.
  }, [publishDay, version, dataVersion, highlights, aiVerdicts])

  if (!data) return null
  const existing = data.members.map((m) => m.username)
  const single = username.trim() === '' ? null : checkNewUsername(username, existing)
  const parsed = parseBulkUsernames(bulk, existing)
  const backupState = keyBackupStatus(data.members, data.meta)
  const passCheck = checkPassphrase(pass, pass2)

  const highlightCount = summary ? summary.days.reduce((sum, d) => sum + d.highlights, 0) : 0
  const aiCount = summary ? summary.days.reduce((sum, d) => sum + d.ai, 0) : 0
  const incompatible = siteStatus?.level === 'incompatible'

  /** İşlemi çalıştırır; hata olursa gösterir. Aynı anda tek işlem yürür. */
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
      setProgress(null)
      notifyMemberAdminChanged()
    }
  }

  const doPublish = async () => {
    setPublishError(null)
    setPublished(null)
    setConfirming(false)
    if (!publishDay) return setPublishError('Yayınlanacak gün yok: önce CSV yükleyin.')
    // Üye sitesi bu paketi açamıyorsa paket üretilmez (yeniden yayınlama yolları dahil).
    if (siteStatus?.level === 'incompatible') return setPublishError(`${siteStatus.text} ${MEMBER_SITE_UPDATE_HINT}`)
    try {
      const publication = await publish(memberAdminRepo, publishSources, publishDay, new Date().toISOString())
      // Dosya yalnızca sızıntı denetimi geçtikten sonra indirilir.
      downloadText(PUBLICATION_FILE_NAME, publication.text, 'application/json')
      setPublished(publication)
      // Pakete giren öne çıkan seçimler "yayınlandı" oldu: kartlar ve liste yenilenir.
      await refresh()
    } catch (e) {
      setPublishError(messageOf(e))
    }
  }

  const onAdd = () =>
    run(async () => {
      if (!single?.ok) return
      const logins = await addMembers(memberAdminRepo, [single.username], new Date().toISOString())
      setIssued({ logins, kind: 'new', downloaded: false })
      setUsername('')
    })

  const onBulk = () =>
    run(async () => {
      if (parsed.usernames.length === 0) return
      setProgress({ done: 0, total: parsed.usernames.length })
      const logins = await addMembers(memberAdminRepo, parsed.usernames, new Date().toISOString(), (done, total) => setProgress({ done, total }))
      setIssued({ logins, kind: 'new', downloaded: false })
      setBulk('')
    })

  const onRemove = (name: string, republish: boolean) => {
    const question = republish
      ? `“${name}” çıkarılacak ve hemen yeni yayın paketi indirilecek. Çıkarma, yeni paketi siteye yüklediğinizde etkili olur. Devam edilsin mi?`
      : `“${name}” çıkarılacak. DİKKAT: yeniden yayınlayana dek yayındaki paketi açmaya devam eder. Devam edilsin mi?`
    if (!window.confirm(question)) return
    void run(async () => {
      await removeMemberByName(memberAdminRepo, name, new Date().toISOString())
      if (republish) await doPublish()
    })
  }

  const onRenew = (name: string) => {
    if (!window.confirm(`“${name}” için yeni şifre üretilecek; eski şifre bir sonraki yayından itibaren çalışmaz. Devam edilsin mi?`)) return
    void run(async () => {
      const login = await renewMemberPassword(memberAdminRepo, name, new Date().toISOString())
      setIssued({ logins: [login], kind: 'renew', downloaded: false })
    })
  }

  const onKeyBackup = () =>
    run(async () => {
      setKeyStatus(null)
      const now = new Date()
      const { file, fileName } = await backupMemberKeys(memberAdminRepo, pass, now.toISOString(), toAppDateTime(now).date)
      downloadText(fileName, JSON.stringify(file), 'application/json')
      setPass('')
      setPass2('')
      setKeyStatus({ kind: 'ok', text: `Üye anahtar yedeği indirildi: ${fileName}. Parolayı unutmayın; parola olmadan yedek açılamaz.` })
    })

  const onKeyRestore = () => {
    if (!restoreFile) return
    if (data.members.length > 0 && !window.confirm('Bu tarayıcıdaki üye listesinin TAMAMI yedektekiyle değiştirilecek. Devam edilsin mi?')) return
    void run(async () => {
      setKeyStatus(null)
      try {
        const snapshot = await restoreMemberKeys(memberAdminRepo, await restoreFile.text(), restorePass, new Date().toISOString())
        setKeyStatus({ kind: 'ok', text: `Üye anahtar yedeği yüklendi: ${snapshot.members.filter((m) => m.active).length} aktif üye, son yayın no ${snapshot.publishCounter}.` })
        setRestorePass('')
        setRestoreFile(null)
        setIssued(null)
      } catch (e) {
        setKeyStatus({ kind: 'error', text: messageOf(e) })
      }
    })
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setRestoreFile(e.target.files?.[0] ?? null)
    setKeyStatus(null)
  }

  return (
    <>
      <Card title="ÜYE SAYFASI: ÜYELER" testId="member-admin-members">
        <p className="mt-1 text-sm text-muted">
          Üyeler <span className="font-semibold text-white">{MEMBER_SITE_URL}</span> adresinde, verdiğiniz kullanıcı adı ve şifreyle yalnızca yayınladığınız analizleri görür. Şifreyi uygulama üretir ve bir kez gösterir; şifre hiçbir yere kaydedilmez. Üye listesi normal veri yedeğine girmez.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold">Üye ekle</h3>
            <div className="mt-2 flex gap-2">
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="kullanici.adi" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} data-testid="member-add-username" className={INPUT} />
              <button type="button" className={`${PRIMARY} shrink-0`} disabled={busy || !single?.ok} onClick={() => void onAdd()} data-testid="member-add">
                Ekle
              </button>
            </div>
            {single && !single.ok && (
              <p className="mt-1.5 text-xs text-loss-text" data-testid="member-add-problem">
                {USERNAME_PROBLEM_TEXTS[single.problem]}
              </p>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-extrabold">Toplu ekle</h3>
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={'her satırda bir kullanıcı adı\nali\nveli'} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} data-testid="member-bulk-input" className={`${INPUT} mt-2 font-mono`} />
            {bulk.trim() !== '' && (
              <p className="mt-1.5 text-xs text-muted" data-testid="member-bulk-preview">
                {parsed.usernames.length} geçerli ad
                {parsed.rejected.length > 0 && (
                  <span className="text-loss-text">
                    {' '}
                    · {parsed.rejected.length} satır alınmayacak: {parsed.rejected.map((r) => `${r.line}. satır “${r.text}” (${r.problem === 'taken' ? 'dolu' : 'geçersiz'})`).join(', ')}
                  </span>
                )}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" className={PRIMARY} disabled={busy || parsed.usernames.length === 0} onClick={() => void onBulk()} data-testid="member-bulk-add">
                {parsed.usernames.length > 0 ? `${parsed.usernames.length} üye ekle` : 'Toplu ekle'}
              </button>
              <span className="text-xs text-muted">Her üye için yaklaşık 0,7 sn sürer (50 üye ≈ yarım dakika).</span>
            </div>
            {progress && (
              <div className="mt-2" role="status" data-testid="member-bulk-progress">
                <div className="h-2 w-full overflow-hidden rounded-full bg-navy-800">
                  <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {progress.done} / {progress.total} üye hazırlandı
                </p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-loss-text" data-testid="member-admin-error">
            {error}
          </p>
        )}
        {issued && (
          <IssuedBox
            issued={issued}
            data={data}
            busy={busy}
            onClose={() => setIssued(null)}
            onDownloaded={() => setIssued({ ...issued, downloaded: true })}
            onRepublish={() => void run(doPublish)}
          />
        )}

        <h3 className="mt-5 text-sm font-extrabold">
          Üye listesi <span className="font-normal text-muted">· {activeCount} aktif, {data.members.length - activeCount} çıkarılmış</span>
        </h3>
        {data.members.length === 0 ? (
          <p className="mt-2 text-sm text-muted" data-testid="member-list-empty">
            Henüz üye yok.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm" data-testid="member-list">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Kullanıcı adı</th>
                  <th className="py-2 pr-3 font-semibold">Durum</th>
                  <th className="py-2 pr-3 font-semibold">Oluşturma</th>
                  <th className="py-2 font-semibold">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.username} className="border-b border-line last:border-0" data-testid={`member-row-${m.username}`} data-active={m.active}>
                    <th scope="row" className="py-2 pr-3 font-semibold">
                      {m.username}
                    </th>
                    <td className="py-2 pr-3">
                      {m.active ? <span className="text-win">Aktif</span> : <span className="text-muted">Çıkarıldı{m.removedAt && ` · ${stamp(m.removedAt)}`}</span>}
                      {m.active && m.renewedAt && <span className="block text-[11px] text-muted">şifre yenilendi · {stamp(m.renewedAt)}</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted">{stamp(m.createdAt)}</td>
                    <td className="py-2">
                      {m.active && (
                        <span className="flex flex-wrap gap-1.5">
                          <button type="button" className={`${SMALL} border-brand text-brand`} disabled={busy} onClick={() => onRemove(m.username, true)} data-testid={`member-remove-republish-${m.username}`}>
                            Çıkar ve hemen yeniden yayınla
                          </button>
                          <button type="button" className={SMALL} disabled={busy} onClick={() => onRemove(m.username, false)} data-testid={`member-remove-${m.username}`}>
                            Yalnızca çıkar
                          </button>
                          <button type="button" className={SMALL} disabled={busy} onClick={() => onRenew(m.username)} data-testid={`member-renew-${m.username}`}>
                            Şifreyi yenile
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Çıkarılan üye yeniden etkinleştirilmez; gerekirse başka bir kullanıcı adıyla yeni hesap açılır. Çıkarılan üye, çıkarılmadan önce gördüğü içeriği saklamış olabilir.</p>
      </Card>

      <Card title="ÜYE SAYFASI: YAYINLA" testId="member-admin-publish">
        <p className="mt-1 text-sm text-muted">Seçilen gün ile önceki 6 günün (son 7 gün; önerisi olmayan günler atlanır) listeleri ve istatistikler, izinli alanlardan sıfırdan kurulup aktif üyeler için şifrelenir ve {PUBLICATION_FILE_NAME} olarak indirilir. Günlerin “öne çıkan” seçimleri de pakete girer (yüzde ve güvenilirlik olmadan). Ham veri, oranlar ve yapay zekâ kararları pakete girmez.</p>
        <p className="mt-1 text-xs text-muted" data-testid="publish-order">
          Yayın sırası: önce üye sitesi (<span className="font-mono">npm run uye-yayinla</span>), sonra paket (<span className="font-mono">npm run yayinla</span>). Üye sitesi eski sürümdeyse yeni paketi açamaz.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-sm font-semibold">
            Gün
            <select value={publishDay ?? ''} onChange={(e) => setDay(e.target.value)} disabled={busy || dates.length === 0} data-testid="publish-day" className={`${INPUT} mt-1 w-auto`}>
              {dates.length === 0 && <option value="">veri yok</option>}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatPlainDate(d)}
                  {d === today ? ' (bugün)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="pb-1.5 text-sm" data-testid="publish-active-count">
            <span className="font-extrabold">{activeCount}</span> aktif üye · sıradaki yayın no <span className="font-extrabold">{data.meta.publishCounter + 1}</span>
          </p>
        </div>

        {siteStatus && siteStatus.level !== 'ok' && (
          <p
            className={`mt-3 rounded-xl border p-3 text-sm ${siteStatus.level === 'incompatible' ? 'border-loss-line bg-loss-soft font-bold text-loss-text' : siteStatus.level === 'older' ? 'border-warn-line bg-warn-soft text-warn' : 'border-navy-500 bg-navy-800 text-muted'}`}
            data-testid="publish-site-version"
            data-level={siteStatus.level}
          >
            {siteStatus.level !== 'unknown' && <span aria-hidden="true">⚠ </span>}
            {siteStatus.text}
            {siteStatus.level !== 'unknown' && <span className="font-normal"> {MEMBER_SITE_UPDATE_HINT}</span>}
          </p>
        )}
        {siteStatus?.level === 'ok' && (
          <p className="mt-3 text-xs text-muted" data-testid="publish-site-version" data-level="ok">
            {siteStatus.text}
          </p>
        )}

        {summary && (
          <ul className="mt-3 space-y-0.5 text-sm text-muted" data-testid="publish-summary">
            {summary.days.map((d) => (
              <li key={d.date}>
                <span className="font-semibold text-white">{formatPlainDate(d.date)}:</span> {d.matches} maç · {d.items} öneri · {d.lists} dolu kategori · {d.highlights} öne çıkan · {d.ai} AI satırı
              </li>
            ))}
            <li>Paketin düz boyutu yaklaşık {kilobytes(summary.plainBytes)} (şifreli hâli bunun üçte biri kadar daha büyük olur)</li>
          </ul>
        )}

        {activeCount === 0 ? (
          <p className="mt-3 rounded-xl border border-warn-line bg-warn-soft p-3 text-sm font-bold text-warn" data-testid="publish-no-members">
            Aktif üye yok. Boş paket üretilmez; önce üye ekleyin.
          </p>
        ) : !confirming ? (
          <button type="button" className={`${PRIMARY} mt-3`} disabled={busy || !publishDay || !summary} onClick={() => setConfirming(true)} data-testid="publish-start">
            Yayınla…
          </button>
        ) : (
          <div className="mt-3 rounded-xl border border-navy-500 bg-navy-800 p-3" data-testid="publish-confirm-box">
            <p className="text-sm">
              <span className="font-bold">{formatPlainDate(publishDay!)}</span> ve önceki 6 gün (önerisi olanlar), <span className="font-bold">{activeCount} aktif üye</span> için yayın no <span className="font-bold">{data.meta.publishCounter + 1}</span> olarak paketlenecek.
            </p>
            {highlightCount > 0 && (
              <p className="mt-1.5 rounded-lg border border-warn-line bg-warn-soft px-2.5 py-1.5 text-sm font-semibold text-warn" data-testid="publish-highlights">
                Bu yayında {highlightCount} öne çıkan var; yayından sonra kaldırılamaz.
              </p>
            )}
            <p className="mt-1.5 text-sm text-muted" data-testid="publish-ai">
              {aiCount > 0
                ? `Bu yayında ${aiCount} maçın “AI öneri güveni” satırı üyelere gidiyor (yalnızca karar seviyeleri; gerekçe, risk ve skor tahmini gitmez).`
                : 'Bu yayında “AI öneri güveni” satırı giden maç yok.'}
            </p>
            {incompatible && (
              <p className="mt-1.5 text-sm font-bold text-loss-text" data-testid="publish-blocked">
                Üye sitesi bu paketi açamıyor; önce üye sitesini güncelleyin ({MEMBER_SITE_UPDATE_HINT}).
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={PRIMARY} disabled={busy || incompatible} onClick={() => void run(doPublish)} data-testid="publish-confirm">
                Onayla ve {PUBLICATION_FILE_NAME} indir
              </button>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setConfirming(false)}>
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {published && (
          <div className="mt-3 rounded-xl border border-win-line bg-win-soft p-3 text-sm" data-testid="publish-result">
            <p className="font-bold text-win">✓ Sızıntı denetimi geçti ({published.leakChecked} ham değerle karşılaştırıldı, şema tam)</p>
            <p className="mt-1 text-white">
              Yayın no {published.record.n} · {published.record.memberCount} üye · {kilobytes(published.record.bytes)} · {PUBLICATION_FILE_NAME} indirildi.
            </p>
            <p className="mt-1 text-muted">Paket, siteye yüklenene dek üyelere ulaşmaz. İndirilen dosyayı yayın klasörüne koyup yayınlayın.</p>
          </div>
        )}
        {publishError && (
          <p className="mt-3 rounded-xl border border-loss-line bg-loss-soft p-3 text-sm font-bold text-loss-text" data-testid="publish-error">
            {publishError}
          </p>
        )}

        <h3 className="mt-5 text-sm font-extrabold">Yayın geçmişi</h3>
        {data.publications.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Henüz yayın yok.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[440px] text-left text-sm tabular-nums" data-testid="publish-history">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">No</th>
                  <th className="py-2 pr-3 font-semibold">Zaman</th>
                  <th className="py-2 pr-3 font-semibold">Gün</th>
                  <th className="py-2 pr-3 text-right font-semibold">Üye</th>
                  <th className="py-2 text-right font-semibold">Boyut</th>
                </tr>
              </thead>
              <tbody>
                {data.publications.slice(0, 20).map((p) => (
                  <tr key={p.n} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pr-3 font-semibold">
                      {p.n}
                    </th>
                    <td className="py-2 pr-3 whitespace-nowrap">{stamp(p.publishedAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDay(p.day)}</td>
                    <td className="py-2 pr-3 text-right">{p.memberCount}</td>
                    <td className="py-2 text-right">{kilobytes(p.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Geçmişte yalnızca özet tutulur; yayınlanan içerik saklanmaz.</p>
      </Card>

      <Card title="ÜYE SAYFASI: ÜYE ANAHTAR YEDEĞİ" testId="member-admin-keybackup">
        <p className="mt-2 rounded-xl border border-loss-line bg-loss-soft p-3 text-base font-extrabold text-loss-text">⚠ {KEY_BACKUP_LOSS_TEXT}</p>
        <p className="mt-2 text-sm text-muted">Üye listesi ve üyelerin anahtarları yalnızca bu tarayıcıda durur ve normal veri yedeğine girmez. Bu yedek, belirlediğiniz parolayla şifrelenmiş ayrı bir dosyadır; parola olmadan açılamaz.</p>
        <p className="mt-2 text-sm font-bold" data-testid="keybackup-state" data-level={backupState.level}>
          {backupState.level === 'none' ? 'Henüz üye yok.' : backupState.text}
          {data.meta.lastKeyBackupAt && <span className="font-normal text-muted"> Son yedek: {stamp(data.meta.lastKeyBackupAt)}.</span>}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold">Üye anahtar yedeği indir</h3>
            <label className="mt-2 block text-xs font-bold text-muted">
              Parola (en az {PASSPHRASE_MIN_LENGTH} karakter)
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" disabled={busy} data-testid="keybackup-pass" className={`${INPUT} mt-1`} />
            </label>
            <label className="mt-2 block text-xs font-bold text-muted">
              Parola (yeniden)
              <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" disabled={busy} data-testid="keybackup-pass2" className={`${INPUT} mt-1`} />
            </label>
            {pass !== '' && passCheck.error && (
              <p className="mt-1.5 text-xs text-loss-text" data-testid="keybackup-pass-error">
                {passCheck.error}
              </p>
            )}
            {passCheck.warnings.map((warning) => (
              <p key={warning} className="mt-1.5 text-xs text-warn" data-testid="keybackup-pass-warning">
                ⚠ Zayıf parola: {warning}
              </p>
            ))}
            <button type="button" className={`${PRIMARY} mt-3`} disabled={busy || !passCheck.ok || data.members.length === 0} onClick={() => void onKeyBackup()} data-testid="keybackup-download">
              Üye anahtar yedeği indir
            </button>
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-extrabold">Üye anahtar yedeğini yükle</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => fileInput.current?.click()}>
                Dosya seç
              </button>
              <span className="min-w-0 truncate text-xs text-muted">{restoreFile ? restoreFile.name : 'dosya seçilmedi'}</span>
              <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} data-testid="keybackup-file" />
            </div>
            <label className="mt-2 block text-xs font-bold text-muted">
              Yedeğin parolası
              <input type="password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} autoComplete="off" disabled={busy} data-testid="keybackup-restore-pass" className={`${INPUT} mt-1`} />
            </label>
            <button type="button" className={`${SECONDARY} mt-3`} disabled={busy || !restoreFile || restorePass === ''} onClick={onKeyRestore} data-testid="keybackup-restore">
              Yedeği yükle
            </button>
          </div>
        </div>
        {keyStatus && (
          <p className={`mt-3 text-sm font-bold ${keyStatus.kind === 'ok' ? 'text-win' : 'text-loss-text'}`} data-testid="keybackup-status" data-kind={keyStatus.kind}>
            {keyStatus.text}
          </p>
        )}
      </Card>
    </>
  )
}
