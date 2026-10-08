import { AI_PROVIDERS, type AiProvider } from '../../config/ai'
import type { AiVerdict, Match, MatchResult, ScoreLine } from '../../types'
import { LOW_SAMPLE_LIMIT } from './statsEngine'

// Skor tahminleri deneyi: skor modelinin ve yapay zekâların tahmin ettiği skor,
// girilen gerçek skorla karşılaştırılır. Yalnızca ölçer; önerileri, dondurmayı ve
// diğer istatistikleri etkilemez.

/** ref11 / ref21: her maçta aynı skoru söyleyen karşılaştırma referansları */
export type ScoreSourceId = 'model' | AiProvider | 'ref11' | 'ref21'

export const SCORE_SOURCES: { id: ScoreSourceId; label: string; reference?: ScoreLine }[] = [
  { id: 'model', label: 'Model' },
  ...AI_PROVIDERS.map((p) => ({ id: p.id as ScoreSourceId, label: p.label })),
  { id: 'ref11', label: 'Referans: hep 1-1', reference: { home: 1, away: 1 } },
  { id: 'ref21', label: 'Referans: hep 2-1', reference: { home: 2, away: 1 } },
]

export interface ScoreStatsRow {
  id: ScoreSourceId
  label: string
  /** Skoru girilmiş ve bu kaynağın tahmini olan maç sayısı */
  n: number
  /** Tam skor isabeti, yüzde (bir ondalık); n = 0 ise null */
  exact: number | null
  /** Sonuç (ev / beraberlik / deplasman) isabeti, yüzde (bir ondalık) */
  outcome: number | null
  /** Toplam gol ortalama mutlak hata (iki ondalık) */
  totalGoalsError: number | null
  lowSample: boolean
}

export interface ScoreStats {
  rows: ScoreStatsRow[]
  /** Kapsamda skoru girilmiş (tamamlanmış) maç sayısı */
  scored: number
  /** Maç başladıktan sonra kaydedildiği için ölçüme girmeyen yapay zekâ tahmini sayısı */
  late: number
}

const sign = (s: ScoreLine): number => Math.sign(s.home - s.away)
const rate = (hits: number, n: number): number | null => (n === 0 ? null : Math.round((hits / n) * 1000) / 10)

/** Bir kaynağın tahminleri ile gerçek skorlar: [tahmin, gerçek] çiftleri */
export function scoreRow(id: ScoreSourceId, label: string, pairs: [ScoreLine, ScoreLine][]): ScoreStatsRow {
  const n = pairs.length
  const exact = pairs.filter(([p, a]) => p.home === a.home && p.away === a.away).length
  const outcome = pairs.filter(([p, a]) => sign(p) === sign(a)).length
  const error = pairs.reduce((sum, [p, a]) => sum + Math.abs(p.home + p.away - (a.home + a.away)), 0)
  return {
    id,
    label,
    n,
    exact: rate(exact, n),
    outcome: rate(outcome, n),
    totalGoalsError: n === 0 ? null : Math.round((error / n) * 100) / 100,
    lowSample: n < LOW_SAMPLE_LIMIT,
  }
}

/** Girilmiş maç sonucu; maç tamamlanmadıysa ya da skor yoksa null */
export const actualScore = (result: MatchResult | undefined): ScoreLine | null =>
  result && result.status === 'completed' && result.ftHome !== null && result.ftAway !== null ? { home: result.ftHome, away: result.ftAway } : null

export interface ScoreStatsInput {
  /** Kapsamdaki maçlar (kapsam, maçın gününe göre çağıran tarafından uygulanır) */
  matches: Match[]
  results: MatchResult[]
  verdicts: AiVerdict[]
}

/**
 * Kaynak başına skor tahmini ölçümü. Yalnızca skoru girilmiş ve o kaynağın tahmini
 * olan maçlar sayılır; maç başladıktan sonra kaydedilen yapay zekâ tahminleri sayılmaz.
 * Referanslar skoru girilmiş tüm maçlarda ölçülür.
 */
export function buildScoreStats({ matches, results, verdicts }: ScoreStatsInput, sources: readonly (typeof SCORE_SOURCES)[number][] = SCORE_SOURCES): ScoreStats {
  const resultById = new Map(results.map((r) => [r.matchId, r]))
  const scored = matches.flatMap((match) => {
    const actual = actualScore(resultById.get(match.id))
    return actual ? [{ match, actual }] : []
  })
  const scoredIds = new Set(scored.map((s) => s.match.id))
  const pairsFor = (predict: (match: Match) => ScoreLine | null | undefined): [ScoreLine, ScoreLine][] =>
    scored.flatMap(({ match, actual }) => {
      const predicted = predict(match)
      return predicted ? [[predicted, actual] as [ScoreLine, ScoreLine]] : []
    })
  const aiScore = (provider: AiProvider) => (match: Match) => {
    const verdict = verdicts.find((v) => v.matchId === match.id && v.provider === provider)
    return verdict?.score && !verdict.scoreLate ? verdict.score : null
  }
  return {
    rows: sources.map((source) =>
      scoreRow(
        source.id,
        source.label,
        pairsFor(source.reference ? () => source.reference : source.id === 'model' ? (m) => m.scoreSnapshot?.best : aiScore(source.id as AiProvider)),
      ),
    ),
    scored: scored.length,
    late: verdicts.filter((v) => v.score && v.scoreLate && scoredIds.has(v.matchId)).length,
  }
}
