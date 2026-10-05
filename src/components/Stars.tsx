export default function Stars({ count, className = '' }: { count: number; className?: string }) {
  return (
    <span className={`tracking-wider whitespace-nowrap ${className}`} role="img" aria-label={`${count} / 5 yıldız`}>
      <span className="text-brand">{'★'.repeat(count)}</span>
      <span className="text-navy-500">{'★'.repeat(5 - count)}</span>
    </span>
  )
}
