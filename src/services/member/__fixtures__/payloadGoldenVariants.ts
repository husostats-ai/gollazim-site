import { createHash } from 'node:crypto'
import type { LeagueTableRow, LeagueTableSnapshot } from '../../../types'
import { aliasId, NOT_IN_TABLE } from '../../league/matching'
import { buildMemberPayload, type MemberPayloadInput } from '../payload'
import { LEAGUE, LEAGUE_SNAPSHOTS, memberInput } from './rawData'

// Üye paketinin lig tablosu satırları için sabit, tamamen sentetik girdiler (rawData.ts). Özetler payloadGolden.test.ts'tedir.
const withRows = (edit: (row: LeagueTableRow) => LeagueTableRow, pastedAt?: string): LeagueTableSnapshot[] =>
  LEAGUE_SNAPSHOTS.map((s) => ({ ...s, ...(pastedAt && { id: `${s.league}|${pastedAt}`, pastedAt }), rows: s.rows.map(edit) }))

export const GOLDEN_VARIANTS: Record<string, () => MemberPayloadInput> = {
  dogrulanmis: () => memberInput(),
  ppgFarkli: () => memberInput({ leagueTableSnapshots: withRows((r) => ({ ...r, ppg: r.ppg === null ? null : r.ppg + 0.5 })) }),
  ppgYok: () => memberInput({ leagueTableSnapshots: withRows((r) => ({ ...r, ppg: null })) }),
  eskiGoruntu: () => memberInput({ leagueTableSnapshots: withRows((r) => r, '2026-09-20T08:00:00.000Z') }),
  golSutunuYok: () => memberInput({ leagueTableSnapshots: withRows(({ goalsFor: _gf, goalsAgainst: _ga, ...r }) => r) }),
  formVeCsYok: () => memberInput({ leagueTableSnapshots: withRows(({ last5: _l, cs: _c, ...r }) => r) }),
  tablodaYok: () => memberInput({ teamAliases: [{ id: aliasId(LEAGUE, 'Kuzey Yıldızı'), league: LEAGUE, csvTeam: 'Kuzey Yıldızı', tableTeam: NOT_IN_TABLE }] }),
  gecmisYok: () => memberInput({ leagueTableSnapshots: [] }),
}

/** Paketin tamamının özeti (sha256) */
export const payloadSha256 = (input: MemberPayloadInput): string => createHash('sha256').update(JSON.stringify(buildMemberPayload(input))).digest('hex')

/** Lig tablosu satırı olan maçlarda hangi satırların pakete girdiği: [ev sıra, deplasman sıra, ev form, deplasman form] */
export const tableFlags = (input: MemberPayloadInput): Record<string, [boolean, boolean, boolean, boolean]> =>
  Object.fromEntries(
    buildMemberPayload(input)
      .days.flatMap((d) => d.matches)
      .filter((m) => m.homeStanding || m.awayStanding || m.homeForm || m.awayForm)
      .map((m) => [m.home, [!!m.homeStanding, !!m.awayStanding, !!m.homeForm, !!m.awayForm]]),
  )

/** Yalnızca form satırlarının özeti: maç başına (ev, deplasman, ev formu, deplasman formu), paketteki sırayla */
export const formSha256 = (input: MemberPayloadInput): string =>
  createHash('sha256')
    .update(JSON.stringify(buildMemberPayload(input).days.flatMap((d) => d.matches.map((m) => [m.home, m.away, m.homeForm ?? null, m.awayForm ?? null]))))
    .digest('hex')
