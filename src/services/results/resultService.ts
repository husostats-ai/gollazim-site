import type { MatchResult, MatchStatus, Pick } from '../../types'
import { aiRepo, matchesRepo, picksRepo, resultsRepo, settingsRepo } from '../data'
import { buildPicksForResult } from './freeze'
import { parseScores, type ScoreDraft } from './validation'

export class ScoreValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '))
  }
}

/**
 * Skoru doğrular, kaydeder ve maçın önerilerini dondurur / yeniden değerlendirir.
 * Tutarsız skor ScoreValidationError fırlatır ve hiçbir şey kaydedilmez.
 */
export async function saveResult(matchId: string, draft: ScoreDraft, status: MatchStatus): Promise<Pick[]> {
  const parsed = parseScores(draft, status)
  if (!parsed.ok) throw new ScoreValidationError(parsed.errors)

  const match = await matchesRepo.get(matchId)
  if (!match) throw new Error('Maç bulunamadı.')

  const now = new Date().toISOString()
  const result: MatchResult = { matchId, status, ...parsed.scores, updatedAt: now }
  const [dayMatches, thresholds, existing] = await Promise.all([
    matchesRepo.listByDate(match.date),
    settingsRepo.getThresholds(),
    picksRepo.listByMatch(matchId),
  ])
  const picks = buildPicksForResult({ match, dayMatches, thresholds, result, existing, now })

  await resultsRepo.save(result)
  await picksRepo.replaceForMatch(matchId, picks)
  return picks
}

/** Skoru ve maçın dondurulmuş önerilerini siler; maç yeniden canlı analize döner. */
export async function deleteResult(matchId: string): Promise<void> {
  await resultsRepo.remove(matchId)
  await picksRepo.replaceForMatch(matchId, [])
}

/** Maçın tarihi düzenlenirse dondurulmuş önerileri ve yapay zekâ kararlarını da yeni güne taşır. */
export async function movePicksToDate(matchId: string, date: string): Promise<void> {
  const picks = await picksRepo.listByMatch(matchId)
  if (picks.length > 0) await picksRepo.replaceForMatch(matchId, picks.map((p) => ({ ...p, date })))
  const verdicts = (await aiRepo.listVerdicts()).filter((v) => v.matchId === matchId)
  if (verdicts.length > 0) await aiRepo.saveVerdicts(verdicts.map((v) => ({ ...v, date })))
}
