import { useEffect, useState } from 'react'
import { DEFAULT_MEMBER_TEXTS, MEMBER_TEXT_FIELDS, normalizeMemberTexts, type MemberTexts } from '../../config/memberTexts'
import { memberAdminRepo } from '../../services/data'
import { saveMemberTexts } from '../../services/memberAdmin/actions'
import { notifyMemberAdminChanged, useMemberAdminData } from './useMemberAdmin'

/** Üye sayfasının üstündeki iki uyarı metninin ayarı; kaydedilen metinler bir sonraki yayına girer. */
export default function MemberTextsPanel() {
  const data = useMemberAdminData()
  const [draft, setDraft] = useState<MemberTexts | null>(null)
  const [saved, setSaved] = useState(false)
  const stored = data?.meta.texts

  useEffect(() => {
    if (stored) setDraft(stored)
  }, [stored])

  if (!draft || !stored) return null
  const dirty = MEMBER_TEXT_FIELDS.some(({ key }) => draft[key] !== stored[key])
  const isDefault = MEMBER_TEXT_FIELDS.every(({ key }) => stored[key] === DEFAULT_MEMBER_TEXTS[key])

  const save = async (texts: MemberTexts) => {
    await saveMemberTexts(memberAdminRepo, texts)
    setDraft(normalizeMemberTexts(texts))
    setSaved(true)
    notifyMemberAdminChanged()
  }

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="member-texts-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-extrabold tracking-wide">AYARLAR: ÜYE SAYFASI METİNLERİ</h2>
          <p className="mt-1 text-sm text-muted">
            Üye sayfasının üstünde, giriş yaptıktan sonra gösterilen iki uyarı. Kaydedilen metinler bir sonraki yayına girer; boş bırakılan metin varsayılana döner. Giriş ekranındaki uyarılar sabittir.
          </p>
        </div>
        <button type="button" disabled={isDefault && !dirty} onClick={() => void save(DEFAULT_MEMBER_TEXTS)} className="rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold hover:bg-navy-600 disabled:opacity-40">
          Varsayılana sıfırla
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        {MEMBER_TEXT_FIELDS.map(({ key, label, maxLength }) => (
          <label key={key} className="block text-sm font-semibold">
            {label}
            <input
              type="text"
              value={draft[key]}
              maxLength={maxLength}
              onChange={(e) => {
                setSaved(false)
                setDraft({ ...draft, [key]: e.target.value })
              }}
              data-testid={`member-text-${key}`}
              className="mt-1 block w-full rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm font-normal outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!dirty} onClick={() => void save(draft)} data-testid="member-texts-save" className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark disabled:opacity-40">
          Kaydet
        </button>
        {saved && !dirty && (
          <span className="text-sm text-win" data-testid="member-texts-saved">
            Kaydedildi; bir sonraki yayında görünür.
          </span>
        )}
      </div>
    </section>
  )
}
