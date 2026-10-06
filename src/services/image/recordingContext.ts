// Testler için sahte tuval. Test ortamında (node) gerçek tuval yoktur; çizim
// kodu bu nesneye çizer, yapılan çağrılar sırasıyla kaydedilir.

export type Call = [name: string, ...args: unknown[]]

export interface DrawnText {
  text: string
  x: number
  y: number
  /** Yazı boyutu (px) */
  size: number
  align: string
  width: number
}

/** Genişlik, yazı boyutuyla orantılı sabit bir kuraldır: sığdırma dallarını tetiklemeye yeter. */
export const fakeTextWidth = (text: string, size: number): number => [...text].length * size * 0.56

const fontSize = (fontValue: unknown): number => parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(fontValue))![1])

export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[]; texts: DrawnText[] } {
  const calls: Call[] = []
  const texts: DrawnText[] = []
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'start' }
  const gradient = (kind: string, args: unknown[]) => {
    const id = `${kind}(${args.join(',')})`
    return { addColorStop: (offset: number, color: string) => calls.push(['addColorStop', id, offset, color]), toJSON: () => id }
  }
  const measureText = (text: string) => ({ width: fakeTextWidth(text, fontSize(state.font)) })
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'measureText') return measureText
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return (...args: unknown[]) => gradient(prop, args)
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
        if (prop === 'fillText') {
          const [text, x, y] = args as [string, number, number]
          const size = fontSize(target.font)
          texts.push({ text, x, y, size, align: String(target.textAlign), width: fakeTextWidth(text, size) })
        }
      }
    },
    set(target, prop: string, value) {
      target[prop] = value
      calls.push(['=', prop, value])
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts }
}

export const serializeCalls = (calls: Call[]): string => calls.map((c) => JSON.stringify(c)).join('\n')
