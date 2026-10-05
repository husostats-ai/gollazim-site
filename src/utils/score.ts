import type { MatchResult } from '../types'

/** "İY 1-0 · MS 3-1"; girilmeyen bölüm yazılmaz, hiçbiri yoksa null */
export const formatScore = (result: MatchResult | undefined): string | null => {
  if (!result) return null
  const parts: string[] = []
  if (result.htHome !== null && result.htAway !== null) parts.push(`İY ${result.htHome}-${result.htAway}`)
  if (result.ftHome !== null && result.ftAway !== null) parts.push(`MS ${result.ftHome}-${result.ftAway}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
