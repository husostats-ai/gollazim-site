import { createHash } from 'node:crypto'
import type { LeagueTableRow, LeagueTableSnapshot } from '../../../types'
import { aliasId, NOT_IN_TABLE } from '../../league/matching'
import { buildMemberPayload, type MemberPayloadInput } from '../payload'
import { LEAGUE, LEAGUE_SNAPSHOTS, memberInput } from './rawData'

// Üye paketinin lig tablosu satırları için sabit girdiler: payloadGolden.json, verifiedTableRows'a
// ayrılmadan önceki matchForms ile üretilmiştir. Paket bu girdilerle birebir aynı kalmalıdır.
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

/** Paketin tamamının özeti (sha256) ve okunabilir olsun diye maç başına tablo alanları */
export function goldenOf(input: MemberPayloadInput) {
  const payload = buildMemberPayload(input)
  const sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const tables = payload.days.flatMap((d) => d.matches.map(({ home, away, homeStanding, awayStanding, homeForm, awayForm }) => ({ home, away, homeStanding, awayStanding, homeForm, awayForm })))
  return { sha256, tables }
}
