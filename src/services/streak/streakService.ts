import type { StreakStep } from '../../types'
import { matchesRepo, picksRepo, resultsRepo, streakRepo } from '../data'
import { addStreakStep, buildStreak, deleteStreakStep, observeOutcomes, removePendingStep, undoRemoval, type StreakCandidate, type StreakRefusal, type StreakView } from './streak'
import { factsFrom } from './streakFacts'

// Seri takibinin veri deposuyla çalışan kısmı: adımları ve sonuçlarının okunduğu kayıtları
// (maç, skor, dondurulmuş öneri) getirir; işlemleri güncel veriye karşı denetleyip kaydeder.
// Öneri, skor ve maç kayıtlarına yazmaz.

async function read(): Promise<{ records: StreakStep[]; view: StreakView }> {
  const records = await streakRepo.listAll()
  const matchIds = [...new Set(records.map((r) => r.matchId))]
  const [matches, results, picks] = await Promise.all([matchesRepo.getMany(matchIds), resultsRepo.listByMatchIds(matchIds), Promise.all(matchIds.map((id) => picksRepo.listByMatch(id)))])
  return { records, view: buildStreak(records, factsFrom({ matches, results, picks: picks.flat() })) }
}

/**
 * Serinin güncel görünümü. Yeni görülen kesin sonuçlar kayda işlenir (maç verisi sonradan
 * silinirse sonuç oradan okunur; sonuç değiştiyse adım "düzeltildi" olur).
 */
export async function loadStreak(): Promise<StreakView> {
  const first = await read()
  const changed = observeOutcomes(first.view.steps, new Date().toISOString())
  if (changed.length === 0) return first.view
  await streakRepo.putMany(changed)
  return (await read()).view
}

// İşlemler kayıttan hemen önce, güncel veriyle denetlenir: düğme pasif olmasa da kural bozulamaz.

export async function sendToStreak(candidate: StreakCandidate): Promise<StreakRefusal | null> {
  const result = addStreakStep(await loadStreak(), candidate, new Date())
  if (result.ok) await streakRepo.putMany([result.record])
  return result.ok ? null : result.reason
}

export async function takeBackFromStreak(id: string): Promise<StreakRefusal | null> {
  const result = deleteStreakStep(await loadStreak(), id, new Date())
  if (result.ok) await streakRepo.remove(id)
  return result.ok ? null : result.reason
}

export async function removePendingFromStreak(id: string): Promise<StreakRefusal | null> {
  const result = removePendingStep(await loadStreak(), id, new Date())
  if (result.ok) await streakRepo.putMany([result.record])
  return result.ok ? null : result.reason
}

export async function undoStreakRemoval(id: string): Promise<StreakRefusal | null> {
  const result = undoRemoval(await loadStreak(), id)
  if (result.ok) await streakRepo.putMany([result.record])
  return result.ok ? null : result.reason
}
