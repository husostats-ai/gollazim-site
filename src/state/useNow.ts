import { useEffect, useState } from 'react'

/** Güncel an; verilen aralıkla yenilenir (ör. başlama saati gelen maçın kilidi kendiliğinden görünsün) */
export function useNow(intervalMs = 20_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
