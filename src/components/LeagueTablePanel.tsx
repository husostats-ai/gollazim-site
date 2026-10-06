import { useEffect, useMemo, useState } from 'react'
import { LEAGUE_TABLE_STALE_DAYS } from '../config/reminders'
import { daysBetween } from '../services/daily/checklist'
import { leagueRepo, matchesRepo } from '../services/data'
import { aliasId, matchTeams, NOT_IN_TABLE, type TeamMatch } from '../services/league/matching'
import { parseLeagueTable, type TableParseResult } from '../services/league/parser'
import { tableAgeText } from '../services/league/standing'
import { useApp } from '../state/AppContext'
import type { LeagueTableRow, TeamAlias } from '../types'

const BUTTON = 'rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50'
const FIELD = 'min-w-0 rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-2 text-sm text-white outline-none focus:border-brand'
/** Seçim kutusunda "kendiliğinden eşleşsin" (kayıtlı seçimi kaldır) değeri */
const AUTO = '__auto__'

const KIND_TEXT: Record<TeamMatch['kind'], string> = { alias: 'Seçildi', exact: 'Tam eşleşme', normalized: 'Normalize eşleşme', none: 'Eşleşmedi' }
const REASON_TEXT: Record<NonNullable<TeamMatch['reason']>, string> = {
  'declared-absent': 'tabloda yok olarak işaretlendi',
  ambiguous: 'birden fazla aday var',
  'no-candidate': 'benzer ad bulunamadı',
  'alias-missing': 'seçilen takım bu tabloda yok',
  'age-mismatch': 'benzer ad var ama yaş grubu eki (U21 vb.) farklı',
}

/** Lig tablosu yapıştırma: yalnızca kartta gösterilir; analizi, seviyeyi ve yıldızı etkilemez. */
export default function LeagueTablePanel() {
  const { leagueTables, teamAliases, dataVersion, refresh } = useApp()
  const [teamsByLeague, setTeamsByLeague] = useState<Record<string, string[]>>({})
  const [league, setLeague] = useState('')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<TableParseResult | null>(null)
  /** Kaydedilmemiş "bu takım hangisi?" seçimleri: CSV takımı -> tablo takımı, '' ya da AUTO */
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void matchesRepo.listTeamsByLeague().then(setTeamsByLeague)
  }, [dataVersion])

  const leagues = Object.keys(teamsByLeague)
  const selected = leagues.includes(league) ? league : (leagues[0] ?? '')
  const stored = leagueTables.find((t) => t.league === selected)
  const csvTeams = teamsByLeague[selected] ?? []

  // Önizlemede yapıştırılan (henüz kaydedilmemiş) satırlar, yoksa kayıtlı tablo
  const rows: LeagueTableRow[] = useMemo(
    () => (preview ? preview.rows.map((r) => ({ team: r.team, rank: r.rank, played: r.played, points: r.points, ppg: r.ppg })) : (stored?.rows ?? [])),
    [preview, stored],
  )
  // Kayıtlı seçimlerin üzerine taslak seçimler uygulanır.
  const aliases: TeamAlias[] = useMemo(() => {
    const kept = teamAliases.filter((a) => a.league === selected && draft[a.csvTeam] === undefined)
    const drafted = Object.entries(draft)
      .filter(([, tableTeam]) => tableTeam !== AUTO)
      .map(([csvTeam, tableTeam]) => ({ id: aliasId(selected, csvTeam), league: selected, csvTeam, tableTeam }))
    return [...kept, ...drafted]
  }, [teamAliases, selected, draft])
  const matches = useMemo(() => matchTeams(selected, csvTeams, rows, aliases), [selected, csvTeams, rows, aliases])
  const matchedTableTeams = new Set(matches.flatMap((m) => (m.row ? [m.row.team] : [])))
  const unmatchedCsv = matches.filter((m) => !m.row)
  const unmatchedTable = rows.filter((r) => !matchedTableTeams.has(r.team))

  const reset = () => {
    setPreview(null)
    setDraft({})
    setMessage(null)
  }

  const saveAliases = async () => {
    for (const [csvTeam, tableTeam] of Object.entries(draft)) {
      if (tableTeam === AUTO) await leagueRepo.removeAlias(aliasId(selected, csvTeam))
    }
    await leagueRepo.saveAliases(aliases.filter((a) => draft[a.csvTeam] !== undefined))
  }

  const onSave = async () => {
    if (preview) await leagueRepo.saveTable({ id: selected, league: selected, pastedAt: new Date().toISOString(), rows })
    await saveAliases()
    await refresh()
    setMessage(preview ? `${rows.length} takımlık tablo kaydedildi.` : 'Eşleştirmeler kaydedildi.')
    setPreview(null)
    setDraft({})
    setText('')
  }

  const storedAge = stored ? Math.max(0, daysBetween(new Date(stored.pastedAt), new Date())) : null

  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid="league-panel">
      <h2 className="font-extrabold tracking-wide">LİG TABLOSU YAPIŞTIR</h2>
      <p className="mt-1 text-sm text-muted">
        FootyStats lig tablosunu kopyalayıp yapıştırın. Yalnızca kartlarda “Ligde N. sıra · M maç” bilgisi olarak
        gösterilir; analizi, güvenilirlik seviyesini, yıldızı, sıralamayı ve yapay zekâ prompt’unu etkilemez.
      </p>

      {leagues.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Henüz maç verisi yok.</p>
      ) : (
        <>
          <label className="mt-3 flex max-w-full min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
            Lig
            <select
              value={selected}
              onChange={(e) => {
                setLeague(e.target.value)
                reset()
              }}
              data-testid="league-select"
              className={`${FIELD} max-w-full flex-1 font-bold`}
            >
              {leagues.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <p className="mt-2 text-xs text-muted" data-testid="league-stored">
            {stored
              ? `Kayıtlı tablo: ${stored.rows.length} takım, ${tableAgeText(storedAge!)}${storedAge! > LEAGUE_TABLE_STALE_DAYS ? ' (güncel değil)' : ''}.`
              : 'Bu lig için kayıtlı tablo yok.'}
          </p>

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setPreview(null)
              setMessage(null)
            }}
            rows={6}
            placeholder="Tabloyu buraya yapıştırın"
            aria-label="Lig tablosu metni"
            data-testid="league-text"
            className={`${FIELD} mt-3 block w-full font-mono text-xs leading-relaxed`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPreview(parseLeagueTable(text))
                setMessage(null)
              }}
              disabled={text.trim() === ''}
              data-testid="league-preview"
              className={`${BUTTON} border border-brand text-brand hover:bg-navy-600`}
            >
              Önizle
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={preview ? rows.length === 0 : Object.keys(draft).length === 0}
              data-testid="league-save"
              className={`${BUTTON} bg-brand text-navy-950 hover:bg-brand-dark`}
            >
              {preview || !stored ? 'Kaydet' : 'Eşleştirmeleri kaydet'}
            </button>
          </div>
          {message && (
            <p className="mt-2 text-sm text-win" role="status" data-testid="league-message">
              {message}
            </p>
          )}

          {preview && (
            <div className="mt-4" data-testid="league-preview-result">
              <p className="text-sm">
                <span className="font-bold">Önizleme (kaydedilmedi):</span>{' '}
                <span data-testid="league-preview-summary">
                  {preview.rows.length} satır okundu · {preview.errors.length} satır sağlamadan geçmedi
                </span>
              </p>
              {preview.errors.length > 0 && (
                <ul className="mt-2 space-y-1.5 rounded-xl border border-loss-line bg-loss-soft p-3 text-xs" data-testid="league-errors">
                  {preview.errors.map((e) => (
                    <li key={e.line} className="break-words text-loss-text">
                      <span className="font-bold">Satır {e.line}:</span> {e.message} Bu satır kaydedilmez.
                      <span className="mt-0.5 block font-mono text-muted">{e.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.rows.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs" data-testid="league-rows">
                    <thead className="text-muted">
                      <tr className="border-b border-line">
                        {['#', 'Takım', 'MP', 'W', 'D', 'L', 'GF', 'GA', 'Pts', 'PPG', 'Sağlama'].map((h) => (
                          <th key={h} className="py-1.5 pr-2 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {preview.rows.map((r) => (
                        <tr key={r.team} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-2">{r.rank}</td>
                          <td className="py-1.5 pr-2 font-semibold">{r.team}</td>
                          {[r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points].map((v, i) => (
                            <td key={i} className="py-1.5 pr-2">
                              {v}
                            </td>
                          ))}
                          <td className="py-1.5 pr-2">{r.ppg ?? '—'}</td>
                          <td className="py-1.5 text-win">✓ tuttu</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <div className="mt-4" data-testid="league-matching">
              <h3 className="text-sm font-extrabold tracking-wide">TAKIM EŞLEŞTİRME</h3>
              <p className="mt-1 text-xs text-muted" data-testid="league-matching-summary">
                CSV’deki {csvTeams.length} takımdan {matches.length - unmatchedCsv.length} tanesi eşleşti, {unmatchedCsv.length} tanesi
                eşleşmedi. Emin olunmayan eşleşme yapılmaz; eşleşmeyen takımı siz seçin.
              </p>
              <ul className="mt-2 divide-y divide-line">
                {matches.map((m) => (
                  <li key={m.csvTeam} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 text-sm" data-testid="league-match-row" data-kind={m.kind}>
                    <span className="min-w-0 flex-1 basis-48 break-words">
                      <span className="font-semibold">{m.csvTeam}</span>
                      <span className={`block text-xs ${m.row ? 'text-muted' : 'text-warn'}`}>
                        {m.row ? `✓ ${KIND_TEXT[m.kind]}: ${m.row.team} (${m.row.rank}. sıra, ${m.row.played} maç)` : `! ${KIND_TEXT.none}: ${REASON_TEXT[m.reason!]}`}
                      </span>
                    </span>
                    {m.kind !== 'exact' && (
                      <label className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted">
                        Bu takım hangisi?
                        <select
                          value={draft[m.csvTeam] ?? (m.kind === 'alias' || m.reason === 'declared-absent' || m.reason === 'alias-missing' ? (aliases.find((a) => a.csvTeam === m.csvTeam)?.tableTeam ?? AUTO) : AUTO)}
                          onChange={(e) => setDraft({ ...draft, [m.csvTeam]: e.target.value })}
                          aria-label={`${m.csvTeam} hangi takım`}
                          data-testid="league-alias"
                          className={`${FIELD} max-w-[12rem] py-1.5 text-xs`}
                        >
                          <option value={AUTO}>Kendiliğinden eşleşsin</option>
                          {rows.map((r) => (
                            <option key={r.team} value={r.team}>
                              {r.team}
                            </option>
                          ))}
                          <option value={NOT_IN_TABLE}>Tabloda yok</option>
                        </select>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              {unmatchedTable.length > 0 && (
                <p className="mt-2 text-xs text-muted" data-testid="league-unmatched-table">
                  Tabloda olup CSV’de karşılığı bulunmayan takımlar: {unmatchedTable.map((r) => r.team).join(', ')}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
