import { useEffect, useId, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { cleanNoteText, MATCH_NOTE_LIMITS } from '../services/notes/matchNote'
import { imageFromClipboard, NOTE_IMAGE_TYPES, prepareNoteImage } from '../services/notes/noteImage'
import { useApp } from '../state/AppContext'

const SMALL = 'rounded-lg border border-navy-500 px-2.5 py-1 text-xs font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`

/**
 * Maç kartındaki "Özel not": düz metin (en fazla 600 karakter) ve/veya tek görsel (dosya ya da panodan
 * yapıştırılan ekran görüntüsü). Not maça aittir: maçın her kategorideki kartında aynı not görünür.
 * Yalnızca gösterimdir; hiçbir hesaba girmez. "Üyelere göster" açıksa üye paketine gider. Maç başlamış ya da
 * bitmiş olsa da değiştirilebilir.
 */
export default function MatchNotePanel({ matchId }: { matchId: string }) {
  const { matchNotes, saveMatchNote, removeMatchNote } = useApp()
  const note = matchNotes[matchId]
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(note?.text ?? '')
  const [dirty, setDirty] = useState(false)
  // Henüz not yokken seçilen "Üyelere göster" değeri: ilk kayıtta uygulanır.
  const [pendingPublish, setPendingPublish] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const panelId = useId()
  const textId = useId()

  // Kayıtlı metin başka bir karttan (aynı maç) değişirse, düzenlenmiyorsa taslak da güncellenir.
  useEffect(() => {
    if (!dirty) setDraft(note?.text ?? '')
  }, [note?.text, dirty])

  const publish = note ? note.publish : pendingPublish
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    try {
      const reason = await action()
      if (reason) setError(reason)
      return reason
    } finally {
      setBusy(false)
    }
  }

  const saveText = async () => {
    const reason = await run(() => saveMatchNote(matchId, { text: draft, publish }))
    if (!reason) {
      setDirty(false)
      setInfo(null)
    }
  }

  const addImage = async (file: File | null) => {
    if (!file) return
    setInfo(null)
    await run(async () => {
      const prepared = await prepareNoteImage(file)
      if (!prepared.ok) return prepared.reason
      const reason = await saveMatchNote(matchId, { image: prepared.image, publish })
      if (!reason) setInfo(`Görsel eklendi: ${prepared.image.w}×${prepared.image.h} piksel, ${kb(prepared.bytes)}${prepared.quality !== null ? ` (JPEG, kalite ${prepared.quality})` : ' (PNG)'}.`)
      return reason
    })
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    // Aynı dosya yeniden seçilebilsin.
    event.target.value = ''
    void addImage(file)
  }

  // Ctrl+V: panoda görsel varsa (ekran görüntüsü) görsel olarak eklenir; düz metin yapıştırma etkilenmez.
  const onPaste = (event: ClipboardEvent) => {
    const file = imageFromClipboard(event.clipboardData)
    if (!file) return
    event.preventDefault()
    void addImage(file)
  }

  const onPublish = (checked: boolean) => {
    if (!note) return setPendingPublish(checked)
    void run(() => saveMatchNote(matchId, { publish: checked }))
  }

  const removeAll = async () => {
    if (!window.confirm('Bu maçın notu (metin ve görsel) silinsin mi?')) return
    await run(async () => {
      await removeMatchNote(matchId)
      return null
    })
    setDraft('')
    setDirty(false)
    setInfo(null)
  }

  const length = draft.length
  const saved = cleanNoteText(draft) === (note?.text ?? '')

  return (
    <div className="rounded-xl border border-line bg-navy-800/60 text-xs" data-testid="note-panel" data-has-note={note !== undefined}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId} className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-bold" data-testid="note-toggle">
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        Özel not
        {note && (
          <span className="flex items-center gap-1 font-semibold text-brand" data-testid="note-indicator" data-publish={note.publish}>
            <span aria-hidden="true">●</span>
            {[note.text !== undefined && 'metin', note.image !== undefined && 'görsel'].filter(Boolean).join(' + ')}
            {!note.publish && <span className="text-muted">· yalnızca admin</span>}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-2 border-t border-line px-3 py-2.5" onPaste={onPaste}>
          <label htmlFor={textId} className="sr-only">
            Not metni
          </label>
          <textarea
            id={textId}
            value={draft}
            maxLength={MATCH_NOTE_LIMITS.text}
            rows={3}
            placeholder="Düz metin; ekran görüntüsünü burada Ctrl+V ile yapıştırabilirsiniz."
            onChange={(e) => {
              setDraft(e.target.value)
              setDirty(true)
            }}
            className="block w-full min-w-0 resize-y rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm whitespace-pre-wrap outline-none focus:border-brand"
            data-testid="note-text"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className={length >= MATCH_NOTE_LIMITS.text ? 'font-bold text-warn' : 'text-muted'} data-testid="note-count">
              {length}/{MATCH_NOTE_LIMITS.text}
            </span>
            <button type="button" className={SMALL} disabled={busy || saved} onClick={() => void saveText()} data-testid="note-save">
              Metni kaydet
            </button>
            {!saved && <span className="text-warn">Kaydedilmedi</span>}
          </div>

          {note?.image ? (
            <div className="flex flex-wrap items-end gap-2">
              <img src={note.image.dataUrl} width={note.image.w} height={note.image.h} alt="Not görseli" className="h-auto max-h-40 w-auto max-w-full rounded-lg border border-line" data-testid="note-image" />
              <button type="button" className={SMALL} disabled={busy} onClick={() => void run(() => saveMatchNote(matchId, { image: null }))} data-testid="note-remove-image">
                Görseli sil
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${SMALL} cursor-pointer`}>
                Görsel seç…
                <input type="file" accept={NOTE_IMAGE_TYPES.join(',')} className="sr-only" disabled={busy} onChange={onFile} data-testid="note-file" />
              </label>
              <span
                tabIndex={0}
                role="button"
                aria-label="Ekran görüntüsünü yapıştırmak için seçip Ctrl+V'ye basın"
                className="rounded-lg border border-dashed border-navy-500 px-2.5 py-1 text-muted outline-none focus:border-brand focus:text-white"
                data-testid="note-paste"
              >
                ya da buraya tıklayıp Ctrl+V
              </span>
              <span className="text-muted">PNG/JPG/WEBP · en uzun kenar {MATCH_NOTE_LIMITS.side} px · en fazla {kb(MATCH_NOTE_LIMITS.imageBytes)}</span>
            </div>
          )}
          {busy && <p className="text-muted">İşleniyor…</p>}
          {info && <p className="text-muted" data-testid="note-info">{info}</p>}
          {error && (
            <p role="alert" className="font-semibold text-loss-text" data-testid="note-error">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 font-semibold">
              <input type="checkbox" checked={publish} disabled={busy} onChange={(e) => onPublish(e.target.checked)} className="h-4 w-4 accent-brand" data-testid="note-publish" />
              Üyelere göster
            </label>
            {note && (
              <button type="button" className={`${SMALL} ml-auto`} disabled={busy} onClick={() => void removeAll()} data-testid="note-remove">
                Notu sil
              </button>
            )}
          </div>
          <p className="text-muted">{publish ? 'Maç üye paketine girerse not da gider (sonraki yayında).' : 'Not yalnızca burada görünür; üye paketine girmez.'}</p>
        </div>
      )}
    </div>
  )
}
