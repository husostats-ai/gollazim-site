import { baselineOf } from '../../config/leagueBaselines'
import { LEAGUE_GROUPS, leagueGroupOf, type LeagueGroupId } from '../../config/leagueGroups'
import { MAIN_CATEGORY_IDS } from '../../config/mainCategories'
import type { Match, Pick } from '../../types'
import { leagueNameOf } from './leagueStats'
import { LOW_SAMPLE_LIMIT, tally } from './statsEngine'
import { wilsonInterval } from './wilson'

// Lig bazlı ana kategoriler (yalnızca admin İstatistik sayfası ve "Analiz için özet"; okur, hiçbir
// kaydı değiştirmez). Yalnızca ana kategoriler (config/mainCategories) ve sonuçlanmış (tuttu + tutmadı)
// öneriler sayılır. "Lig bazlı başarı" tablosundan farkı: lig sınırı ve "Diğer ligler" toplaması yoktur,
// her lig kategori kategori ayrılır. Kapsam (tümü / paylaşılan) çağıran tarafta önerilere uygulanır.

export type MainCategoryId = (typeof MAIN_CATEGORY_IDS)[number]

/** Bu sayıdan az sonuçlanmış öneride yüzde, aralık ve taban farkı yazılmaz ("az veri") */
export const LEAGUE_CATEGORY_MIN_N = LOW_SAMPLE_LIMIT

export interface CategoryCell {
  decided: number
  won: number
  /** n < LEAGUE_CATEGORY_MIN_N ise null */
  rate: number | null
  /** Wilson %95; n < LEAGUE_CATEGORY_MIN_N ise null */
  interval: { low: number; high: number } | null
  /** Sonuçlanmış önerisi olan benzersiz maç */
  matches: number
  lowSample: boolean
  /** bizim − taban (puan, bir ondalık); yalnızca KG VAR / 2.5 ÜST, tabanı olan lig ve n ≥ 20 */
  baselineGap: number | null
}

interface RowBase {
  decided: number
  matches: number
  cells: Record<MainCategoryId, CategoryCell>
}

export interface LeagueCategoryRow extends RowBase {
  name: string
  group: LeagueGroupId
  baseline: { btts: number; over25: number } | null
}

export interface GroupCategoryRow extends RowBase {
  id: LeagueGroupId | 'unknown' | 'all'
  label: string
  /** Gruptaki ligler (sonuçlanmış öneriye göre azalan) ve öneri sayıları */
  leagues: { name: string; decided: number }[]
}

export interface LeagueCategoryStats {
  leagues: LeagueCategoryRow[]
  /** LEAGUE_GROUPS sırasıyla, her grup (önerisi olmasa da) */
  groups: GroupCategoryRow[]
  /** Maç kaydı olmayan öneriler; yoksa null. Hiçbir gruba girmez. */
  unknown: GroupCategoryRow | null
  total: GroupCategoryRow
  /** Lig tablosu hücre sayımı */
  cellCounts: { cells: number; withData: number; comparable: number; baselineGaps: number }
}

const round1 = (value: number): number => Math.round(value * 10) / 10
const decidedOnly = (picks: Pick[]) => picks.filter((p) => p.outcome === 'won' || p.outcome === 'lost')
const matchCount = (picks: Pick[]): number => new Set(picks.map((p) => p.matchId)).size

function cellOf(picks: Pick[], baseline: number | null): CategoryCell {
  const t = tally(picks)
  const enough = t.decided >= LEAGUE_CATEGORY_MIN_N
  return {
    decided: t.decided,
    won: t.won,
    rate: enough ? t.rate : null,
    interval: enough ? wilsonInterval(t.won, t.decided) : null,
    matches: matchCount(picks),
    lowSample: !enough,
    baselineGap: enough && baseline !== null && t.rate !== null ? round1(t.rate - baseline) : null,
  }
}

function rowBase(picks: Pick[], baseline: { btts: number; over25: number } | null = null): RowBase {
  const cells = Object.fromEntries(
    MAIN_CATEGORY_IDS.map((id) => {
      const value = id === 'btts' ? (baseline?.btts ?? null) : id === 'over25' ? (baseline?.over25 ?? null) : null
      return [id, cellOf(picks.filter((p) => p.categoryId === id), value)]
    }),
  ) as Record<MainCategoryId, CategoryCell>
  return { decided: picks.length, matches: matchCount(picks), cells }
}

/** Lig × ana kategori, sabit grup × ana kategori ve hücre sayımı */
export function buildLeagueCategoryStats(picks: Pick[], matches: Match[]): LeagueCategoryStats {
  const ids: readonly string[] = MAIN_CATEGORY_IDS
  const decided = decidedOnly(picks.filter((p) => ids.includes(p.categoryId)))
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const byLeague = new Map<string, Pick[]>()
  const unknown: Pick[] = []
  for (const pick of decided) {
    const match = matchById.get(pick.matchId)
    if (!match) {
      unknown.push(pick)
      continue
    }
    const name = leagueNameOf(match)
    const list = byLeague.get(name)
    if (list) list.push(pick)
    else byLeague.set(name, [pick])
  }

  const leagues: LeagueCategoryRow[] = [...byLeague]
    .map(([name, list]) => {
      const found = baselineOf(name)
      const baseline = found ? { btts: found.btts, over25: found.over25 } : null
      return { name, group: leagueGroupOf(name), baseline, ...rowBase(list, baseline) }
    })
    .sort((a, b) => b.decided - a.decided || a.name.localeCompare(b.name, 'en'))

  const groups: GroupCategoryRow[] = LEAGUE_GROUPS.map((g) => {
    const members = leagues.filter((l) => l.group === g.id)
    return {
      id: g.id,
      label: g.label,
      leagues: members.map((l) => ({ name: l.name, decided: l.decided })),
      ...rowBase(members.flatMap((l) => byLeague.get(l.name)!)),
    }
  })

  const cells = leagues.flatMap((l) => MAIN_CATEGORY_IDS.map((id) => l.cells[id]))
  return {
    leagues,
    groups,
    unknown: unknown.length > 0 ? { id: 'unknown', label: 'Bilinmiyor (maç kaydı yok)', leagues: [], ...rowBase(unknown) } : null,
    total: { id: 'all', label: 'Tümü', leagues: leagues.map((l) => ({ name: l.name, decided: l.decided })), ...rowBase(decided) },
    cellCounts: {
      cells: cells.length,
      withData: cells.filter((c) => c.decided > 0).length,
      comparable: cells.filter((c) => !c.lowSample).length,
      baselineGaps: cells.filter((c) => c.baselineGap !== null).length,
    },
  }
}
