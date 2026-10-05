import type { MatchResult, MatchStatus } from '../../types'

export const STATUS_LABELS: Record<MatchStatus, string> = {
  completed: 'Tamamlandı',
  pending: 'Tamamlanmadı',
  postponed: 'Ertelendi',
  cancelled: 'İptal',
}

type ScoreFields = Omit<MatchResult, 'matchId' | 'status' | 'updatedAt'>
export type ScoreField = keyof ScoreFields

/** Formdaki ham metinler; boş metin "girilmedi" demektir */
export type ScoreDraft = Record<ScoreField, string>

const PAIRS: { label: string; home: ScoreField; away: ScoreField }[] = [
  { label: 'İlk yarı skoru', home: 'htHome', away: 'htAway' },
  { label: 'Maç sonucu', home: 'ftHome', away: 'ftAway' },
  { label: 'Korner', home: 'cornersHome', away: 'cornersAway' },
  { label: 'Toplam kart', home: 'cardsHome', away: 'cardsAway' },
]

export type ParsedScores = { ok: true; scores: ScoreFields } | { ok: false; errors: string[] }

/**
 * Formdaki değerleri sayıya çevirir ve tutarlılığı denetler. Hata varsa
 * hiçbir şey kaydedilmez; mesajlar kullanıcıya aynen gösterilir.
 */
export function parseScores(draft: ScoreDraft, status: MatchStatus): ParsedScores {
  const errors: string[] = []
  const scores = {} as ScoreFields

  for (const { label, home, away } of PAIRS) {
    for (const field of [home, away]) {
      const text = draft[field].trim()
      if (text === '') scores[field] = null
      else if (/^\d+$/.test(text)) scores[field] = Number(text)
      else {
        scores[field] = null
        errors.push(`${label}: değerler sıfır veya pozitif tam sayı olmalı (“${text}” geçersiz).`)
      }
    }
    if ((draft[home].trim() === '') !== (draft[away].trim() === '')) {
      errors.push(`${label}: iki takımın değeri birlikte girilmeli.`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const { htHome, htAway, ftHome, ftAway } = scores
  if (status === 'completed') {
    if (ftHome === null) errors.push('Maç “Tamamlandı” olarak kaydedilecekse maç sonucu girilmeli.')
    if (htHome === null) errors.push('Maç “Tamamlandı” olarak kaydedilecekse ilk yarı skoru girilmeli.')
  }
  if (htHome !== null && ftHome !== null && ftAway !== null && htAway !== null) {
    if (htHome > ftHome) errors.push(`Ev sahibinin ilk yarı golü (${htHome}) maç sonucundaki golünden (${ftHome}) büyük olamaz.`)
    if (htAway > ftAway) errors.push(`Deplasmanın ilk yarı golü (${htAway}) maç sonucundaki golünden (${ftAway}) büyük olamaz.`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scores }
}
