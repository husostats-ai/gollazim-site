import { useState } from 'react'
import type { PromptChunk } from '../../services/ai/prompt'
import { copyText } from '../../utils/clipboard'

interface Props {
  chunks: PromptChunk[]
  providerLabel: string
  /** Kopyalama başarılı olduğunda numaralandırmayı kaydetmek için çağrılır */
  onCopied: () => Promise<void>
}

export default function PromptPanel({ chunks, providerLabel, onCopied }: Props) {
  const [status, setStatus] = useState<{ index: number; ok: boolean } | null>(null)

  const copy = async (chunk: PromptChunk) => {
    const ok = await copyText(chunk.text)
    if (ok) await onCopied()
    setStatus({ index: chunk.index, ok })
  }

  return (
    <div className="space-y-3">
      {chunks.length > 1 && (
        <p className="text-xs text-muted">
          Maç sayısı 20’yi aştığı için prompt {chunks.length} parçaya bölündü. Her parçayı ayrı bir mesaj olarak
          yapıştırın; cevapları aşağıya birlikte ya da tek tek yapıştırabilirsiniz.
        </p>
      )}
      {chunks.map((chunk) => (
        <div key={chunk.index} className="rounded-xl border border-navy-500 bg-navy-800 p-3" data-testid="prompt-chunk">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {chunks.length > 1 ? `Parça ${chunk.index}/${chunk.total} · ` : ''}
              #{chunk.from}–#{chunk.to}
              <span className="font-normal text-muted"> · {chunk.to - chunk.from + 1} maç</span>
            </p>
            <button
              type="button"
              onClick={() => void copy(chunk)}
              data-testid="copy-prompt"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-navy-950 hover:bg-brand-dark"
            >
              {chunks.length > 1 ? `Parça ${chunk.index} prompt'unu kopyala` : "Prompt'u kopyala"}
            </button>
          </div>
          {status?.index === chunk.index && (
            <p className={`mt-2 text-sm ${status.ok ? 'text-win' : 'text-loss-text'}`} role="status">
              {status.ok
                ? `Kopyalandı. ${providerLabel} uygulamasına yapıştırın.`
                : 'Panoya kopyalanamadı. Aşağıdan prompt’u açıp elle kopyalayın.'}
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-bold text-brand">Prompt’u göster</summary>
            <textarea
              readOnly
              value={chunk.text}
              rows={14}
              data-testid="prompt-text"
              className="mt-2 w-full rounded-lg border border-navy-500 bg-navy-900 p-2.5 font-mono text-xs leading-relaxed outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
        </div>
      ))}
    </div>
  )
}
