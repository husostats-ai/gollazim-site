import type { H2HRow, LastRow, ParsedAnswer, Score, TotalRow, Venue } from './parser'
import { fold } from './parser'
import { checkTotal, computeRates, leagueRows, venueRates, type TeamRates, type TotalCheck, type VenueRates } from './rates'
import { sameTeam, teamDistance } from './teams'

// İki yapay zekâ cevabını maç maç, satır satır karşılaştırır. Saf fonksiyonlardır.
//   kırmızı: maç sonu skoru farklı ya da TOPLAM satırlarla tutmuyor
//   sarı:    devre skoru ya da başka bir alan farklı
//   mavi:    satır yalnızca bir cevapta var (eksik)
//   bilgi:   hesabın dışında bırakılan satırlar ve varsayımlar

export type AiId = 'A' | 'B'
export type Level = 'red' | 'yellow' | 'blue' | 'info'
export const LEVEL_LABELS: Record<Level, string> = { red: 'KIRMIZI', yellow: 'SARI', blue: 'MAVİ', info: 'BİLGİ' }

export interface Warning {
  level: Level
  text: string
}

/** Bir takımın tek bir cevaptaki görünümü */
export interface TeamSide {
  name: string
  rows: LastRow[]
  /** Genel: tüm lig satırları */
  overall: TeamRates
  /** Ev sahibi için İÇ, deplasman takımı için DIŞ lig satırları; taraf bilinmiyorsa null */
  venue: VenueRates | null
  total: TotalRow | null
  totalCheck: TotalCheck | null
}

export interface TeamComparison {
  name: string
  /** Bu maçta ev sahibi mi (home) deplasman mı (away) */
  side: Venue | null
  a: TeamSide | null
  b: TeamSide | null
  /** İki cevapta maç sonu skoru aynı olan satırlardan; cevaplardan biri yoksa null */
  verified: { rows: number; overall: TeamRates; venue: VenueRates | null } | null
}

export interface Fixture {
  id: string
  home: string
  away: string
}

export interface MatchComparison {
  /** Cevaplardaki sıra numarası (#n); o cevapta maç yoksa null */
  noA: number | null
  noB: number | null
  teams: TeamComparison[]
  /** Ev / deplasman bilgisinin kaynağı: uygulamadaki CSV maçı ya da cevaptaki yazılış sırası */
  sideSource: 'csv' | 'order' | null
  /** Eşleşen CSV maçı; yoksa null */
  fixtureId: string | null
  warnings: Warning[]
  notes: { ai: AiId; kind: 'SKOR' | 'HABER'; text: string }[]
  sources: { ai: AiId; site: string; url: string | null }[]
  h2h: Record<AiId, H2HRow[]>
}

const showDate = (date: string | null): string => (date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : 'tarih bilinmiyor')
const showScore = (score: Score | null): string => (score ? `${score.own}-${score.opp}` : 'bilinmiyor')
const showValue = (value: number | null): string => (value === null ? 'bilinmiyor' : String(value))
const sameScore = (a: Score | null, b: Score | null): boolean => a !== null && b !== null && a.own === b.own && a.opp === b.opp
const VENUE_TEXT: Record<Venue, string> = { home: 'İÇ', away: 'DIŞ' }
const showVenue = (venue: Venue | null): string => (venue ? VENUE_TEXT[venue] : 'bilinmiyor')

interface Group {
  no: number
  teams: string[]
  last: LastRow[]
  totals: TotalRow[]
  h2h: H2HRow[]
}

/** Cevabı #n numarasına göre maçlara ayırır; takımlar SON ve TOPLAM satırlarındaki yazılış sırasıyladır */
function groupsOf(answer: ParsedAnswer): Group[] {
  const numbers = [...new Set([...answer.last, ...answer.totals, ...answer.h2h, ...answer.notes].map((row) => row.no))].sort((x, y) => x - y)
  return numbers.map((no) => {
    const last = answer.last.filter((row) => row.no === no)
    const totals = answer.totals.filter((row) => row.no === no)
    const teams: string[] = []
    for (const name of [...last, ...totals].map((row) => row.team)) if (!teams.some((known) => sameTeam(known, name))) teams.push(name)
    return { no, teams, last, totals, h2h: answer.h2h.filter((row) => row.no === no) }
  })
}

/** İki maçın takımları ne kadar örtüşüyor: eşleşen takım sayısı (çok) ve toplam ad farkı (az) */
function overlap(a: Group, b: Group): { matched: number; distance: number } {
  let matched = 0
  let distance = 0
  for (const team of a.teams) {
    const best = Math.min(...b.teams.map((other) => teamDistance(team, other) ?? Infinity))
    if (best !== Infinity) {
      matched++
      distance += best
    }
  }
  return { matched, distance }
}

/** A'daki her maça B'den karşılık bulur: önce takım adlarına, takım yoksa sıra numarasına göre */
function pairGroups(a: Group[], b: Group[]): [Group | null, Group | null][] {
  const free = [...b]
  const pairs: [Group | null, Group | null][] = a.map((group) => {
    let best: Group | null = null
    let bestScore = { matched: 0, distance: Infinity }
    for (const candidate of free) {
      const score = overlap(group, candidate)
      if (score.matched > bestScore.matched || (score.matched === bestScore.matched && score.matched > 0 && score.distance < bestScore.distance)) {
        best = candidate
        bestScore = score
      }
    }
    if (!best && group.teams.length === 0) best = free.find((candidate) => candidate.no === group.no && candidate.teams.length === 0) ?? null
    if (best) free.splice(free.indexOf(best), 1)
    return [group, best]
  })
  return [...pairs, ...free.map((group): [Group | null, Group | null] => [null, group])]
}

/** Aynı takımın iki cevaptaki satırlarını eşler: aynı tarih; tarih yoksa aynı rakip */
function pairRows<T extends { date: string | null }>(a: T[], b: T[], opponentOf: (row: T) => string): { both: [T, T][]; onlyA: T[]; onlyB: T[] } {
  const free = [...b]
  const both: [T, T][] = []
  const onlyA: T[] = []
  for (const row of a) {
    const sameDay = free.filter((other) => row.date !== null && other.date === row.date)
    const found = sameDay.find((other) => sameTeam(opponentOf(row), opponentOf(other))) ?? sameDay[0] ?? free.find((other) => (row.date === null || other.date === null) && sameTeam(opponentOf(row), opponentOf(other)))
    if (found) {
      free.splice(free.indexOf(found), 1)
      both.push([row, found])
    } else onlyA.push(row)
  }
  return { both, onlyA, onlyB: free }
}

function sideOf(group: Group | null, name: string | null, side: Venue | null): TeamSide | null {
  if (!group || name === null) return null
  const rows = group.last.filter((row) => sameTeam(row.team, name))
  const total = group.totals.find((row) => sameTeam(row.team, name)) ?? null
  return { name, rows, overall: computeRates(leagueRows(rows)), venue: side ? venueRates(rows, side) : null, total, totalCheck: total ? checkTotal(total, rows) : null }
}

export interface CompareInput {
  /** Yapıştırılmamış cevap null verilir; o durumda cevaplar arası uyarı üretilmez */
  a: ParsedAnswer | null
  b: ParsedAnswer | null
  labels: Record<AiId, string>
  /** Uygulamadaki günün CSV maçları: ev / deplasman bilgisini doğrulamak ve önerileri yanına koymak için */
  fixtures: Fixture[]
}

export function compareAnswers({ a, b, labels, fixtures }: CompareInput): MatchComparison[] {
  const both = a !== null && b !== null
  const sourcesOf = (ai: AiId, answer: ParsedAnswer | null, group: Group | null): MatchComparison['sources'] => {
    if (!answer || !group) return []
    const names = [...new Set([...group.last, ...group.totals, ...group.h2h].map((row) => row.source).filter((source) => source !== ''))]
    return names.map((site) => {
      const key = fold(site)
      const entry = answer.sources.find((source) => fold(source.site) === key) ?? answer.sources.find((source) => source.site !== '' && (key.includes(fold(source.site)) || fold(source.site).includes(key)))
      return { ai, site, url: entry?.url ?? null }
    })
  }

  return pairGroups(a ? groupsOf(a) : [], b ? groupsOf(b) : []).map(([ga, gb]): MatchComparison => {
    const warnings: Warning[] = []
    const warn = (level: Level, text: string) => void warnings.push({ level, text })

    // Takımlar: A'daki sırayla; B'de yalnızca orada geçen takımlar sona eklenir.
    const freeB = [...(gb?.teams ?? [])]
    const names: { a: string | null; b: string | null }[] = (ga?.teams ?? []).map((name) => {
      const ranked = freeB.map((other) => ({ other, distance: teamDistance(name, other) })).filter((x) => x.distance !== null).sort((x, y) => x.distance! - y.distance!)
      const match = ranked[0]?.other ?? null
      if (match !== null) freeB.splice(freeB.indexOf(match), 1)
      return { a: name, b: match }
    })
    for (const name of freeB) names.push({ a: null, b: name })
    const display = names.map((n) => n.a ?? n.b!)

    // Ev / deplasman: uygulamadaki CSV maçı varsa oradan, yoksa cevaptaki yazılış sırasından.
    let sideSource: MatchComparison['sideSource'] = null
    let fixtureId: string | null = null
    let sides: (Venue | null)[] = display.map(() => null)
    if (display.length === 2) {
      const fixture = fixtures.find((f) => (sameTeam(f.home, display[0]) && sameTeam(f.away, display[1])) || (sameTeam(f.home, display[1]) && sameTeam(f.away, display[0])))
      if (fixture) {
        sideSource = 'csv'
        fixtureId = fixture.id
        sides = sameTeam(fixture.home, display[0]) ? ['home', 'away'] : ['away', 'home']
      } else {
        sideSource = 'order'
        sides = ['home', 'away']
        warn('info', `Ev / deplasman bilgisi cevaptaki yazılış sırasından varsayıldı (ilk takım ev sahibi): ${display[0]} – ${display[1]}. Uygulamada bu maç bulunamadı.`)
      }
    } else if (display.length > 0) warn('info', `Bu maçta ${display.length} takım okundu (2 bekleniyor); iç / dış oranları hesaplanmadı: ${display.join(', ')}`)

    const teams = names.map((n, index): TeamComparison => {
      const name = display[index]
      const side = sides[index]
      const sa = sideOf(ga, n.a, side)
      const sb = sideOf(gb, n.b, side)
      let verified: TeamComparison['verified'] = null

      for (const [ai, one] of [['A', sa], ['B', sb]] as const) {
        if (!one) continue
        const who = `${labels[ai]} · ${one.name}`
        const league = leagueRows(one.rows)
        if (one.overall.noScore > 0) warn('info', `${who}: ${one.overall.noScore} lig satırının maç sonu skoru bilinmiyor; oranlara girmedi`)
        if (league.length - one.overall.noScore - one.overall.htKnown > 0) warn('info', `${who}: ${league.length - one.overall.noScore - one.overall.htKnown} lig satırının devre skoru bilinmiyor; İLK YARI 0.5 ÜST paydasına girmedi (İY bilinen ${one.overall.htKnown})`)
        if (one.venue && one.venue.unknownVenue > 0) warn('info', `${who}: ${one.venue.unknownVenue} lig satırında İÇ / DIŞ bilinmiyor; ${VENUE_TEXT[one.venue.venue]} oranlarına girmedi`)
        if (!one.total) warn('blue', `${who}: TOPLAM satırı yok`)
        else {
          if (one.total.flag) warn('yellow', `${who}: TOPLAM satırındaki not: ${one.total.flag}`)
          const check = one.totalCheck!
          if (check.status === 'mismatch') warn('red', `${who}: TOPLAM, LİG satırlarıyla tutmuyor (${check.differences.join('; ')})`)
          if (check.status === 'unknown') warn('info', `${who}: TOPLAM denetlenemedi (${check.differences.join('; ') || 'oynanan maç sayısı bilinmiyor'})`)
        }
      }

      if (both) {
        const who = name
        if (!sa || !sb) warn('blue', `${who}: yalnızca ${labels[sa ? 'A' : 'B']} cevabında var`)
        else {
          const paired = pairRows(sa.rows, sb.rows, (row) => row.opponent)
          const verifiedRows: LastRow[] = []
          for (const [ra, rb] of paired.both) {
            const what = `${who} ${showDate(ra.date ?? rb.date)} (${ra.opponent})`
            if (ra.ft === null || rb.ft === null) {
              if (ra.ft !== null || rb.ft !== null) warn('blue', `${what}: maç sonu skoru yalnızca ${labels[ra.ft ? 'A' : 'B']} cevabında var (${showScore(ra.ft ?? rb.ft)})`)
            } else if (!sameScore(ra.ft, rb.ft)) warn('red', `${what}: maç sonu skoru farklı; ${labels.A} ${showScore(ra.ft)}, ${labels.B} ${showScore(rb.ft)}`)
            if (ra.ht !== null && rb.ht !== null && !sameScore(ra.ht, rb.ht)) warn('yellow', `${what}: devre skoru farklı; ${labels.A} ${showScore(ra.ht)}, ${labels.B} ${showScore(rb.ht)}`)
            if (!sameTeam(ra.opponent, rb.opponent)) warn('yellow', `${what}: rakip adı farklı; ${labels.A} ${ra.opponent}, ${labels.B} ${rb.opponent}`)
            if (ra.venue !== rb.venue) warn('yellow', `${what}: İÇ / DIŞ farklı; ${labels.A} ${showVenue(ra.venue)}, ${labels.B} ${showVenue(rb.venue)}`)
            if (ra.competition !== rb.competition) warn('yellow', `${what}: yarışma farklı; ${labels.A} ${ra.competitionText || 'bilinmiyor'}, ${labels.B} ${rb.competitionText || 'bilinmiyor'}`)
            // Doğrulanmış satır: maç sonu skoru iki cevapta aynı. Devre skoru, iç / dış ve yarışma
            // yalnızca iki cevap aynı şeyi söylüyorsa kullanılır.
            if (sameScore(ra.ft, rb.ft)) verifiedRows.push({ ...ra, ht: sameScore(ra.ht, rb.ht) ? ra.ht : null, venue: ra.venue === rb.venue ? ra.venue : null, competition: ra.competition === rb.competition ? ra.competition : 'other' })
          }
          for (const [ai, rows] of [['A', paired.onlyA], ['B', paired.onlyB]] as const) for (const row of rows) warn('blue', `${who} ${showDate(row.date)} (${row.opponent}, ${row.competitionText || 'yarışma bilinmiyor'}, ${showScore(row.ft)}): yalnızca ${labels[ai]} cevabında var`)
          verified = { rows: verifiedRows.length, overall: computeRates(leagueRows(verifiedRows)), venue: side ? venueRates(verifiedRows, side) : null }

          if (sa.total && sb.total) {
            const fields: [string, number | null, number | null][] = [
              ['oynanan', sa.total.played, sb.total.played],
              ['galibiyet', sa.total.won, sb.total.won],
              ['beraberlik', sa.total.drawn, sb.total.drawn],
              ['mağlubiyet', sa.total.lost, sb.total.lost],
              ['atılan', sa.total.goalsFor, sb.total.goalsFor],
              ['yenilen', sa.total.goalsAgainst, sb.total.goalsAgainst],
              ['puan', sa.total.points, sb.total.points],
              ['lig sırası', sa.total.rank, sb.total.rank],
            ]
            for (const [label, va, vb] of fields) if (va !== vb) warn('yellow', `${who} TOPLAM: ${label} farklı; ${labels.A} ${showValue(va)}, ${labels.B} ${showValue(vb)}`)
          }
        }
      }
      return { name, side, a: sa, b: sb, verified }
    })

    // H2H
    const h2h: Record<AiId, H2HRow[]> = { A: ga?.h2h ?? [], B: gb?.h2h ?? [] }
    const known: Record<AiId, H2HRow[]> = { A: h2h.A.filter((row) => !row.unknown), B: h2h.B.filter((row) => !row.unknown) }
    for (const ai of ['A', 'B'] as const) {
      const group = ai === 'A' ? ga : gb
      if (!group) continue
      if (known[ai].length === 0) warn('blue', `H2H: ${labels[ai]} cevabında ${h2h[ai].length > 0 ? '"bilinmiyor"' : 'satır yok'}`)
    }
    if (both && ga && gb) {
      const paired = pairRows(known.A, known.B, (row) => row.home)
      for (const [ra, rb] of paired.both) {
        const what = `H2H ${showDate(ra.date ?? rb.date)} (${ra.home} – ${ra.away})`
        // Aynı maç iki cevapta ters yönde yazılmış olabilir.
        const flipped = !sameTeam(ra.home, rb.home) && sameTeam(ra.home, rb.away)
        const flip = (score: Score | null): Score | null => (score && flipped ? { own: score.opp, opp: score.own } : score)
        const [ftB, htB] = [flip(rb.ft), flip(rb.ht)]
        if (ra.ft === null || ftB === null) {
          if (ra.ft !== null || ftB !== null) warn('blue', `${what}: maç sonu skoru yalnızca ${labels[ra.ft ? 'A' : 'B']} cevabında var`)
        } else if (!sameScore(ra.ft, ftB)) warn('red', `${what}: maç sonu skoru farklı; ${labels.A} ${showScore(ra.ft)}, ${labels.B} ${showScore(ftB)}`)
        if (ra.ht !== null && htB !== null && !sameScore(ra.ht, htB)) warn('yellow', `${what}: devre skoru farklı; ${labels.A} ${showScore(ra.ht)}, ${labels.B} ${showScore(htB)}`)
      }
      for (const [ai, rows] of [['A', paired.onlyA], ['B', paired.onlyB]] as const) for (const row of rows) warn('blue', `H2H ${showDate(row.date)} (${row.home} – ${row.away}, ${showScore(row.ft)}): yalnızca ${labels[ai]} cevabında var`)
    }
    if (both && (!ga || !gb)) warn('blue', `Bu maç yalnızca ${labels[ga ? 'A' : 'B']} cevabında var`)

    const notesOf = (ai: AiId, answer: ParsedAnswer | null, group: Group | null) => (answer && group ? answer.notes.filter((note) => note.no === group.no).map((note) => ({ ai, kind: note.kind, text: note.text })) : [])
    const order: Level[] = ['red', 'yellow', 'blue', 'info']
    return {
      noA: ga?.no ?? null,
      noB: gb?.no ?? null,
      teams,
      sideSource,
      fixtureId,
      warnings: order.flatMap((level) => warnings.filter((w) => w.level === level)),
      notes: [...notesOf('A', a, ga), ...notesOf('B', b, gb)],
      sources: [...sourcesOf('A', a, ga), ...sourcesOf('B', b, gb)],
      h2h,
    }
  })
}

/** Maçın başlığı: "#3 Ev – Dep" */
export function matchTitle(match: MatchComparison): string {
  const home = match.teams.find((team) => team.side === 'home') ?? match.teams[0]
  const away = match.teams.find((team) => team !== home)
  const no = match.noA ?? match.noB
  return `#${no} ${home ? home.name : 'takım okunamadı'}${away ? ` – ${away.name}` : ''}`
}

/** "Tüm uyarıları kopyala" metni; bilgi satırları dahil değildir */
export function warningsText(matches: MatchComparison[]): string {
  return matches
    .map((match) => ({ title: matchTitle(match), lines: match.warnings.filter((w) => w.level !== 'info').map((w) => `[${LEVEL_LABELS[w.level]}] ${w.text}`) }))
    .filter((block) => block.lines.length > 0)
    .map((block) => [block.title, ...block.lines].join('\n'))
    .join('\n\n')
}
