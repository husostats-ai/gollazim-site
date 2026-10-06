import type { Match, ScoreSnapshot } from '../../types'
import { scoreTable, type OutcomeProbs } from './sideGoals/scoreModel'
import { buildSideGoalsModel, type SideGoalsSource } from './sideGoals/sideGoals'

// Skor olasılıkları: Taraf & Gol'de kullanılan skor modelinin (piyasa oranına
// kalibre, oran yoksa xG) tablosundan okunur; yeni bir model değildir. Yalnızca
// iç kullanım içindir: görsellere ve paylaşım metinlerine girmez, önerileri etkilemez.

export interface ScoreProbability {
  home: number
  away: number
  /** 0-1 */
  probability: number
}

export interface ScoreForecast {
  source: SideGoalsSource
  /** En olası skorlar, olasılığı yüksekten düşüğe */
  top: ScoreProbability[]
  /** Toplam gol dağılımı: [0, 1, 2, 3, 4+] gol olasılıkları (0-1) */
  totals: [number, number, number, number, number]
  outcome: OutcomeProbs
  /** Beklenen toplam gol (ev + deplasman beklentisi) */
  expectedGoals: number
}

export const TOP_SCORE_COUNT = 3

/** Piyasa oranı kullanılan iki kaynak da "Piyasa tabanlı", yalnızca xG olan "xG tabanlı" */
export const sourceLabel = (source: SideGoalsSource | 'none'): string =>
  source === 'none' ? 'Veri yok' : source === 'xg' ? 'xG tabanlı' : 'Piyasa tabanlı'

/** Maçın skor olasılıkları; oran da xG de yoksa null (uydurma yapılmaz). */
export function scoreForecast(match: Match): ScoreForecast | null {
  const model = buildSideGoalsModel(match)
  if (!model) return null
  const table = scoreTable(model.main.home, model.main.away)
  const cells: ScoreProbability[] = []
  const totals: ScoreForecast['totals'] = [0, 0, 0, 0, 0]
  const outcome: OutcomeProbs = { home: 0, draw: 0, away: 0 }
  table.forEach((row, home) =>
    row.forEach((probability, away) => {
      cells.push({ home, away, probability })
      totals[Math.min(4, home + away)] += probability
      outcome[home > away ? 'home' : home < away ? 'away' : 'draw'] += probability
    }),
  )
  // Eşit olasılıkta daha az gollü skor öne gelir ki sıra kararlı olsun.
  cells.sort((x, y) => y.probability - x.probability || x.home + x.away - (y.home + y.away) || x.home - y.home)
  return { source: model.source, top: cells.slice(0, TOP_SCORE_COUNT), totals, outcome, expectedGoals: model.main.home + model.main.away }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

/**
 * Maçın ilk "tamamlandı" anında kayda yazılan anlık görüntü. Yüzdeler bir
 * ondalığa yuvarlanır; veri yoksa kaynak 'none' olur ve skor yazılmaz.
 */
export function buildScoreSnapshot(match: Match, now: string): ScoreSnapshot {
  const forecast = scoreForecast(match)
  if (!forecast) return { source: 'none', takenAt: now }
  const top = forecast.top.map((s) => ({ home: s.home, away: s.away, percent: round(s.probability * 100, 1) }))
  return {
    source: forecast.source,
    takenAt: now,
    best: { home: top[0].home, away: top[0].away },
    top,
    outcome: { home: round(forecast.outcome.home * 100, 1), draw: round(forecast.outcome.draw * 100, 1), away: round(forecast.outcome.away * 100, 1) },
    expectedGoals: round(forecast.expectedGoals, 2),
  }
}

/** Anlık görüntü yalnızca bir kez, maç ilk "tamamlandı" kaydedilirken alınır; sonradan değişmez. */
export const snapshotToSave = (match: Match, status: string, now: string): ScoreSnapshot | null =>
  status === 'completed' && !match.scoreSnapshot ? buildScoreSnapshot(match, now) : null
