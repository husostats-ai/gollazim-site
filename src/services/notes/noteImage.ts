import type { MatchNoteImage } from '../../types'
import { dataUrlBytes } from '../member/schema'
import { MATCH_NOTE_LIMITS } from './matchNote'

// Not görselinin tarayıcıda küçültülmesi. Seçilen dosya ya da panodan yapıştırılan ekran görüntüsü
// en uzun kenarı MATCH_NOTE_LIMITS.side pikseli geçmeyecek biçimde yeniden çizilir ve JPEG olarak
// kodlanır (şeffaf görsel önce PNG denenir). Sonuç MATCH_NOTE_LIMITS.imageBytes'ı aşarsa kalite
// adım adım düşürülür; en düşük kalitede de büyükse görsel reddedilir.

export const NOTE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']
/** Kaynak dosyanın sınırları: bundan büyüğü çözülmeye çalışılmaz (tarayıcı belleği) */
export const NOTE_SOURCE_LIMITS = { bytes: 20 * 1024 * 1024, pixels: 40_000_000 } as const
/** JPEG kalite basamakları: ilk değer varsayılan, sonrakiler boyut sınırı aşılınca denenir */
export const NOTE_JPEG_QUALITIES: readonly number[] = [0.82, 0.72, 0.62, 0.52, 0.42]
/** Şeffaf görsel PNG olarak sınırı aşarsa JPEG'e geçerken altına konan zemin */
const FLATTEN_BACKGROUND = '#ffffff'

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`

export type NoteImageResult = { ok: true; image: MatchNoteImage; bytes: number; type: 'image/jpeg' | 'image/png'; quality: number | null } | { ok: false; reason: string }

/** En uzun kenarı max'ı geçmeyecek boyut (büyütülmez; her kenar en az 1 piksel) */
export function fitSize(width: number, height: number, max: number = MATCH_NOTE_LIMITS.side): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

/** Kaynak dosyanın türü ve boyutu kabul ediliyor mu; sorun yoksa null */
export function checkSource(type: string, bytes: number): string | null {
  if (!NOTE_IMAGE_TYPES.includes(type)) return 'Yalnızca PNG, JPG ve WEBP görseller kabul edilir.'
  if (bytes > NOTE_SOURCE_LIMITS.bytes) return `Dosya çok büyük (${kb(bytes)}); en fazla ${kb(NOTE_SOURCE_LIMITS.bytes)} olabilir.`
  return null
}

/**
 * Kodlama basamakları (saf: kodlayıcılar dışarıdan verilir). Şeffaf görselde önce PNG denenir; sınırı aşarsa
 * (ya da şeffaflık yoksa) JPEG kalite basamakları sırayla denenir. Hiçbiri sınıra girmezse neden döner.
 */
export function encodeWithinLimit(size: { w: number; h: number }, hasAlpha: boolean, encodePng: () => string, encodeJpeg: (quality: number) => string, limit: number = MATCH_NOTE_LIMITS.imageBytes): NoteImageResult {
  if (hasAlpha) {
    const png = encodePng()
    const bytes = dataUrlBytes(png)
    if (png.startsWith('data:image/png;') && bytes <= limit) return { ok: true, image: { dataUrl: png, ...size }, bytes, type: 'image/png', quality: null }
  }
  let smallest = Infinity
  for (const quality of NOTE_JPEG_QUALITIES) {
    const jpeg = encodeJpeg(quality)
    // Tarayıcı JPEG kodlayamazsa PNG döndürür; o zaman bu yol kullanılamaz.
    if (!jpeg.startsWith('data:image/jpeg;')) return { ok: false, reason: 'Tarayıcı görseli JPEG olarak kodlayamadı.' }
    const bytes = dataUrlBytes(jpeg)
    if (bytes <= limit) return { ok: true, image: { dataUrl: jpeg, ...size }, bytes, type: 'image/jpeg', quality }
    smallest = Math.min(smallest, bytes)
  }
  return { ok: false, reason: `Görsel ${size.w}×${size.h} piksele küçültülüp en düşük kalitede kodlandığında bile ${kb(smallest)}; sınır ${kb(limit)}. Daha sade ya da daha küçük bir görsel deneyin.` }
}

/**
 * Görseli yükler. Boyutlar yüklenince bilinir; piksel sınırını aşan görsel çözülmeden reddedilir (çok büyük
 * görselde tarayıcının çözme adımı başarısız olur ve "açılamadı" denirdi).
 */
async function load(file: Blob): Promise<{ image: HTMLImageElement; release: () => void } | string> {
  const url = URL.createObjectURL(file)
  const release = () => URL.revokeObjectURL(url)
  const image = new Image()
  const loaded = await new Promise<boolean>((done) => {
    image.onload = () => done(true)
    image.onerror = () => done(false)
    image.src = url
  })
  const width = image.naturalWidth
  const height = image.naturalHeight
  const problem = !loaded || width < 1 || height < 1 ? 'Görsel açılamadı (dosya bozuk ya da desteklenmiyor).' : width * height > NOTE_SOURCE_LIMITS.pixels ? `Görsel çok büyük (${width}×${height} piksel); en fazla ${NOTE_SOURCE_LIMITS.pixels / 1_000_000} milyon piksel olabilir.` : null
  if (problem) {
    release()
    return problem
  }
  try {
    await image.decode()
  } catch {
    release()
    return 'Görsel açılamadı (dosya bozuk ya da desteklenmiyor).'
  }
  return { image, release }
}

/** Görseli hedef boyuta çizer; çok küçültmede ara adımlarla yarıya indirir (kenar tırtığı olmasın) */
function draw(source: CanvasImageSource, width: number, height: number, target: { w: number; h: number }): HTMLCanvasElement {
  let current: CanvasImageSource = source
  let w = width
  let h = height
  while (w / 2 >= target.w * 1.5 && h / 2 >= target.h * 1.5) {
    const step = document.createElement('canvas')
    step.width = Math.round(w / 2)
    step.height = Math.round(h / 2)
    const ctx = step.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, step.width, step.height)
    current = step
    w = step.width
    h = step.height
  }
  const canvas = document.createElement('canvas')
  canvas.width = target.w
  canvas.height = target.h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(current, 0, 0, target.w, target.h)
  return canvas
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/** Dosyayı (ya da panodan gelen görseli) not görseline çevirir. Yalnızca tarayıcıda çalışır. */
export async function prepareNoteImage(file: Blob): Promise<NoteImageResult> {
  const problem = checkSource(file.type, file.size)
  if (problem) return { ok: false, reason: problem }
  const loaded = await load(file)
  if (typeof loaded === 'string') return { ok: false, reason: loaded }
  const { image, release } = loaded
  const width = image.naturalWidth
  const height = image.naturalHeight
  const size = fitSize(width, height)
  let canvas: HTMLCanvasElement
  try {
    canvas = draw(image, width, height, size)
  } finally {
    release()
  }
  // JPEG şeffaflığı taşımaz: yalnızca PNG/WEBP kaynakta bakılır.
  const alpha = file.type !== 'image/jpeg' && hasTransparency(canvas)
  let flat: HTMLCanvasElement | null = null
  const flattened = (): HTMLCanvasElement => {
    if (!alpha) return canvas
    if (!flat) {
      flat = document.createElement('canvas')
      flat.width = size.w
      flat.height = size.h
      const ctx = flat.getContext('2d')!
      ctx.fillStyle = FLATTEN_BACKGROUND
      ctx.fillRect(0, 0, size.w, size.h)
      ctx.drawImage(canvas, 0, 0)
    }
    return flat
  }
  return encodeWithinLimit(size, alpha, () => canvas.toDataURL('image/png'), (quality) => flattened().toDataURL('image/jpeg', quality))
}

/** Panodan yapıştırılan içerikteki ilk görsel dosyası (yoksa null) */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}
