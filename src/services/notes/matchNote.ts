import type { MatchNote, MatchNoteImage } from '../../types'
import type { MemberNoteInput } from '../member/payload'
import { dataUrlBytes, MEMBER_NOTE_LIMITS, NOTE_IMAGE_DATA_URL } from '../member/schema'

// Maç kartındaki "Özel not": kurallar ve kayıt dönüşümleri (saf fonksiyonlar). Not yalnızca gösterimdir;
// analiz, istatistik, AI, Story/Telegram ve dışa aktarım kodu bu modülü kullanmaz (testle denetlenir).

/** Metin ve görsel sınırları üye paketinin şemasıyla aynıdır (tek kaynak: schema.ts) */
export const MATCH_NOTE_LIMITS = MEMBER_NOTE_LIMITS

export type NoteTextProblem = 'too-long' | 'link'

export const NOTE_TEXT_PROBLEM_TEXTS: Record<NoteTextProblem, string> = {
  'too-long': `Not en fazla ${MATCH_NOTE_LIMITS.text} karakter olabilir.`,
  // Paket yayın öncesi sızıntı denetiminden geçer; bağlantı içeren paket indirilmez.
  link: 'Notta bağlantı (http://, https://, www.) bulunamaz: üye paketi bağlantı taşımaz.',
}

const LINK = /https?:\/\/|www\./i

/** Satır sonları \n'e çevrilir, sekme ve satır sonu dışındaki denetim karakterleri atılır, baştaki ve sondaki boşluk kırpılır. */
export const cleanNoteText = (raw: string): string =>
  raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()

/** Temizlenmiş metnin sorunu; sorun yoksa null */
export function checkNoteText(text: string): NoteTextProblem | null {
  if (text.length > MATCH_NOTE_LIMITS.text) return 'too-long'
  if (LINK.test(text)) return 'link'
  return null
}

/** Görsel kaydın biçimi ve sınırları geçerli mi */
export const isNoteImage = (value: unknown): value is MatchNoteImage => {
  if (typeof value !== 'object' || value === null) return false
  const { dataUrl, w, h } = value as Partial<MatchNoteImage>
  const side = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MATCH_NOTE_LIMITS.side
  return typeof dataUrl === 'string' && NOTE_IMAGE_DATA_URL.test(dataUrl) && dataUrlBytes(dataUrl) <= MATCH_NOTE_LIMITS.imageBytes && side(w) && side(h)
}

/** Notta gösterilecek bir şey var mı (metin ya da görsel) */
export const hasNoteContent = (note: Pick<MatchNote, 'text' | 'image'> | undefined): boolean => note !== undefined && (note.text !== undefined || note.image !== undefined)

/**
 * Nottaki değişiklik. text: undefined = dokunma, '' = metni sil. image: undefined = dokunma, null = görseli sil.
 * publish: undefined = dokunma.
 */
export interface NoteChange {
  text?: string
  image?: MatchNoteImage | null
  publish?: boolean
}

export type NoteChangeResult = { ok: true; note: MatchNote | null } | { ok: false; reason: string }

/**
 * Değişikliği nota uygular. Sonuçta metin de görsel de yoksa not null döner (kayıt silinir). Yeni
 * notta "Üyelere göster" açıktır. Maç başlamış ya da bitmiş olsa da not değiştirilebilir.
 */
export function applyNoteChange(matchId: string, existing: MatchNote | undefined, change: NoteChange, now: Date): NoteChangeResult {
  let text = existing?.text
  if (change.text !== undefined) {
    const cleaned = cleanNoteText(change.text)
    const problem = checkNoteText(cleaned)
    if (problem) return { ok: false, reason: NOTE_TEXT_PROBLEM_TEXTS[problem] }
    text = cleaned === '' ? undefined : cleaned
  }
  let image = existing?.image
  if (change.image === null) image = undefined
  else if (change.image !== undefined) {
    if (!isNoteImage(change.image)) return { ok: false, reason: 'Görsel geçersiz ya da sınırların dışında.' }
    image = { dataUrl: change.image.dataUrl, w: change.image.w, h: change.image.h }
  }
  if (text === undefined && image === undefined) return { ok: true, note: null }
  const note: MatchNote = { matchId, publish: change.publish ?? existing?.publish ?? true, updatedAt: now.toISOString() }
  if (text !== undefined) note.text = text
  if (image !== undefined) note.image = image
  return { ok: true, note }
}

/**
 * Yedekten okunan notlar: biçimi bozuk, boş ya da sınırları aşan kayıt atlanır; maçı yedekte olmayan not
 * (maç silinmiş) alınmaz. Notu olmayan eski yedekte hiç not gelmez.
 */
export function normalizeMatchNotes(raw: unknown, matchIds: ReadonlySet<string>): MatchNote[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const notes: MatchNote[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const r = entry as Partial<MatchNote>
    if (typeof r.matchId !== 'string' || !matchIds.has(r.matchId) || seen.has(r.matchId)) continue
    const text = typeof r.text === 'string' ? cleanNoteText(r.text) : ''
    const textOk = text !== '' && checkNoteText(text) === null
    const imageOk = r.image !== undefined && isNoteImage(r.image)
    if (!textOk && !imageOk) continue
    seen.add(r.matchId)
    const note: MatchNote = { matchId: r.matchId, publish: r.publish !== false, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString() }
    if (textOk) note.text = text
    if (imageOk) note.image = { dataUrl: r.image!.dataUrl, w: r.image!.w, h: r.image!.h }
    notes.push(note)
  }
  return notes
}

/**
 * Notları paket kurucusunun girdisine indirger: yalnızca "Üyelere göster" açık olanlar ve yalnızca metin ile
 * görsel. İşaret ve değişiklik anı kurucuya hiç verilmez.
 */
export const memberNoteInputs = (notes: readonly MatchNote[]): MemberNoteInput[] =>
  notes
    .filter((n) => n.publish === true && hasNoteContent(n))
    .map((n) => {
      const input: MemberNoteInput = { matchId: n.matchId }
      if (n.text !== undefined) input.text = n.text
      if (n.image !== undefined) input.image = { dataUrl: n.image.dataUrl, w: n.image.w, h: n.image.h }
      return input
    })
