import type { ReactNode } from 'react'

export default function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-600 bg-navy-800 px-5 py-10 text-center text-sm text-muted">
      {children}
    </div>
  )
}
