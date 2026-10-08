import { useMemo, useState } from 'react'
import { CATEGORIES } from '../config/categories'
import { collectAiMatches } from '../services/ai/collect'
import { analyzeDay } from '../services/analysis/engine'
import { compareAnswers, LEVEL_LABELS, matchTitle, warningsText, type AiId, type Level, type MatchComparison, type TeamComparison, type TeamSide } from '../services/rawCompare/compare'
import { parseAnswer, type H2HRow, type ParsedAnswer, type Venue } from '../services/rawCompare/parser'
import { buildRawPrompts, PROMPT_V3_GROUP_SIZE } from '../services/rawCompare/promptV3'
import { RATE_KEYS, RATE_LABELS, type Rate, type TeamRates, type TotalCheck } from '../services/rawCompare/rates'
import { useApp } from '../state/AppContext'
import { copyText } from '../utils/clipboard'
import { formatPlainDate } from '../utils/format'

// Admin aracı: iki yapay zekânın ham maç verisi cevabı yapıştırılır; oranlar sayılır, cevaplar
// birbiriyle ve günün CSV önerileriyle karşılaştırılır. HİÇBİR ŞEY KAYDEDİLMEZ: metinler yalnızca
// bu bileşenin durumundadır, sayfa yenilenince gider. Eşik, yıldız, güvenilirlik ve model
// hesabına dokunmaz; üye sitesine ve yayın paketine girmez.

const AIS: AiId[] = ['A', 'B']
const INPUT = 'block w-full min-w-0 rounded-lg border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-sm outline-none focus:border-brand'
const SECONDARY = 'rounded-xl border border-navy-500 px-3.5 py-2 text-sm font-bold hover:bg-navy-600 disabled:cursor-not-allowed disabled:opacity-40'
const LEVEL_TONE: Record<Level, string> = {
  red: 'border-loss-line bg-loss-soft text-loss-text',
  yellow: 'border-warn-line bg-warn-soft text-warn',
  blue: 'border-info-line bg-info-soft text-info',
  info: 'border-navy-500 bg-navy-800 text-muted',
}
const VENUE_LABELS: Record<Venue, string> = { home: 'İÇ', away: 'DIŞ' }
const SIDE_LABELS: Record<Venue, string> = { home: 'ev sahibi', away: 'deplasman' }
const CHECK_TEXT: Record<TotalCheck['status'], string> = { ok: '✓ LİG satırlarıyla tutuyor', mismatch: '✗ LİG satırlarıyla TUTMUYOR', 'too-many': 'denetlenmedi (oynanan 8’den çok)', unknown: 'denetlenemedi' }

const known = (value: number | null): string => (value === null ? 'bilinmiyor' : String(value))
const showDate = (date: string | null): string => (date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : 'tarih bilinmiyor')

function RateCell({ rate }: { rate: Rate | null }) {
  if (rate === null) return <td className="px-1 py-1 text-right sm:px-2 text-muted">—</td>
  if (rate.n === 0) return <td className="px-1 py-1 text-right sm:px-2 text-muted">veri yok</td>
  return (
    <td className="px-1 py-1 text-right sm:px-2 whitespace-nowrap">
      <span className="font-bold">
        {rate.hit}/{rate.n}
      </span>{' '}
      <span className="block text-muted sm:inline">%{Math.round((rate.hit / rate.n) * 100)}</span>
    </td>
  )
}

/** Bir oran bloğu (genel ya da iç / dış): dört oran ve "İY bilinen" satırı, üç sütunda */
function RateBlock({ title, note, columns }: { title: string; note?: string; columns: (TeamRates | null)[] }) {
  return (
    <>
      <tr className="border-t border-line">
        <th colSpan={columns.length + 1} scope="colgroup" className="px-2 pt-2 pb-1 text-left text-[11px] font-bold tracking-wide text-brand">
          {title}
          {note && <span className="font-normal text-muted"> · {note}</span>}
        </th>
      </tr>
      {RATE_KEYS.map((key) => (
        <tr key={key}>
          <th scope="row" className="px-1 py-1 text-left sm:px-2 font-semibold">
            {RATE_LABELS[key]}
          </th>
          {columns.map((rates, i) => (
            <RateCell key={i} rate={rates ? rates[key] : null} />
          ))}
        </tr>
      ))}
      <tr className="text-muted">
        <th scope="row" className="px-1 py-1 text-left sm:px-2 font-normal">
          İY bilinen / lig maçı
        </th>
        {columns.map((rates, i) => (
          <td key={i} className="px-1 py-1 text-right sm:px-2 whitespace-nowrap">
            {rates ? `${rates.htKnown} / ${rates.matches}` : '—'}
          </td>
        ))}
      </tr>
    </>
  )
}

function TotalLine({ label, side }: { label: string; side: TeamSide }) {
  const total = side.total
  if (!total) return <p className="text-muted">{label} TOPLAM: bilinmiyor (satır yok)</p>
  const check = side.totalCheck!
  return (
    <p className="break-words">
      <span className="font-semibold text-white">{label} TOPLAM:</span> oynanan {known(total.played)} · G-B-M {known(total.won)}-{known(total.drawn)}-{known(total.lost)} · gol {known(total.goalsFor)}-{known(total.goalsAgainst)} · {known(total.points)} puan · lig sırası {known(total.rank)}
      {' · '}
      <span className={check.status === 'mismatch' ? 'font-bold text-loss-text' : check.status === 'ok' ? 'font-semibold text-win' : ''} data-testid="raw-total-check" data-status={check.status}>
        {CHECK_TEXT[check.status]}
      </span>
      {total.flag && <span className="font-semibold text-warn"> · not: {total.flag}</span>}
    </p>
  )
}

function TeamTable({ team, labels }: { team: TeamComparison; labels: Record<AiId, string> }) {
  const venue = team.side
  const unknownVenue = AIS.map((ai) => ({ ai, count: (ai === 'A' ? team.a : team.b)?.venue?.unknownVenue ?? 0 })).filter((x) => x.count > 0)
  return (
    <section className="min-w-0" data-testid="raw-team">
      <h4 className="font-extrabold break-words">
        {team.name}
        {venue && <span className="ml-1.5 text-xs font-semibold text-muted">{SIDE_LABELS[venue]}</span>}
        {team.a && team.b && team.a.name !== team.b.name && (
          <span className="ml-1.5 text-xs font-normal text-muted">
            ({labels.A}: {team.a.name} · {labels.B}: {team.b.name})
          </span>
        )}
      </h4>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="px-1 py-1 text-left sm:px-2 font-semibold">Yalnızca LİG</th>
              <th className="px-1 py-1 text-right sm:px-2 font-semibold">{labels.A}</th>
              <th className="px-1 py-1 text-right sm:px-2 font-semibold">{labels.B}</th>
              <th className="px-1 py-1 text-right sm:px-2 font-semibold">Doğrulanmış</th>
            </tr>
          </thead>
          <tbody>
            <RateBlock title="GENEL" columns={[team.a?.overall ?? null, team.b?.overall ?? null, team.verified?.overall ?? null]} />
            {venue ? (
              <RateBlock
                title={`YALNIZCA ${VENUE_LABELS[venue]}`}
                note={unknownVenue.length > 0 ? `İÇ / DIŞ bilinmeyen satır dışarıda: ${unknownVenue.map((x) => `${labels[x.ai]} ${x.count}`).join(', ')}` : undefined}
                columns={[team.a?.venue?.rates ?? null, team.b?.venue?.rates ?? null, team.verified?.venue?.rates ?? null]}
              />
            ) : (
              <tr className="border-t border-line">
                <td colSpan={4} className="px-2 py-1.5 text-muted">
                  İç / dış oranları: bilinmiyor (bu takımın ev sahibi mi deplasman mı olduğu belirlenemedi)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-muted">
        {team.a && <TotalLine label={labels.A} side={team.a} />}
        {team.b && <TotalLine label={labels.B} side={team.b} />}
        {team.verified && <p>Doğrulanmış satır (maç sonu skoru iki cevapta aynı, tüm yarışmalar): {team.verified.rows}</p>}
      </div>
    </section>
  )
}

const h2hText = (row: H2HRow): string =>
  row.unknown ? 'bilinmiyor' : `${showDate(row.date)} · ${row.home} ${row.ft ? `${row.ft.own}-${row.ft.opp}` : 'skor bilinmiyor'} ${row.away} · İY ${row.ht ? `${row.ht.own}-${row.ht.opp}` : 'bilinmiyor'}${row.competitionText ? ` · ${row.competitionText}` : ''}`

function MatchCard({ match, labels, suggestions }: { match: MatchComparison; labels: Record<AiId, string>; suggestions: { label: string; percent: number }[] | null }) {
  const counted = (['red', 'yellow', 'blue'] as const).map((level) => ({ level, count: match.warnings.filter((w) => w.level === level).length })).filter((x) => x.count > 0)
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-navy-800 p-3 sm:p-4" data-testid="raw-match">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-extrabold break-words">{matchTitle(match)}</h3>
        {counted.map(({ level, count }) => (
          <span key={level} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${LEVEL_TONE[level]}`}>
            {count} {LEVEL_LABELS[level].toLocaleLowerCase('tr')}
          </span>
        ))}
      </div>

      <p className="mt-1 text-xs break-words text-muted" data-testid="raw-csv">
        <span className="font-semibold text-white">CSV önerileri:</span>{' '}
        {suggestions === null ? 'bilinmiyor (seçili günün CSV maçları arasında bu maç bulunamadı)' : suggestions.length === 0 ? 'bu maç için öneri yok' : suggestions.map((s) => `${s.label} %${s.percent}`).join(' · ')}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {match.teams.map((team) => (
          <TeamTable key={team.name} team={team} labels={labels} />
        ))}
      </div>

      {match.warnings.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="raw-warnings">
          {match.warnings.map((warning, i) => (
            <li key={i} className={`rounded-lg border px-2.5 py-1.5 text-xs break-words ${LEVEL_TONE[warning.level]}`} data-level={warning.level}>
              <span className="font-bold">{LEVEL_LABELS[warning.level]}:</span> {warning.text}
            </li>
          ))}
        </ul>
      )}

      {AIS.some((ai) => match.h2h[ai].length > 0) && (
        <div className="mt-3 text-xs">
          <h4 className="font-bold tracking-wide text-muted">H2H</h4>
          <ul className="mt-1 space-y-0.5">
            {AIS.flatMap((ai) =>
              match.h2h[ai].map((row, i) => (
                <li key={`${ai}${i}`} className="break-words">
                  <span className="font-semibold text-brand">{labels[ai]}:</span> {h2hText(row)}
                </li>
              )),
            )}
          </ul>
        </div>
      )}

      {match.notes.length > 0 && (
        <div className="mt-3 text-xs">
          <h4 className="font-bold tracking-wide text-muted">SKOR / HABER</h4>
          <ul className="mt-1 space-y-0.5" data-testid="raw-notes">
            {match.notes.map((note, i) => (
              <li key={i} className="break-words">
                <span className="font-semibold text-brand">{labels[note.ai]}</span> <span className="font-semibold">{note.kind}:</span> {note.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {match.sources.length > 0 && (
        <div className="mt-3 text-xs">
          <h4 className="font-bold tracking-wide text-muted">KAYNAKLAR</h4>
          <ul className="mt-1 space-y-0.5" data-testid="raw-sources">
            {match.sources.map((source, i) => (
              <li key={i} className="break-all">
                <span className="font-semibold text-brand">{labels[source.ai]}:</span> {source.site}
                {source.url ? (
                  <>
                    {' · '}
                    <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-info underline">
                      {source.url}
                    </a>
                  </>
                ) : (
                  <span className="text-muted"> · adres bilinmiyor</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

function Unparsed({ label, answer }: { label: string; answer: ParsedAnswer | null }) {
  if (!answer || answer.unparsed.length === 0) return null
  return (
    <details className="mt-2 rounded-lg border border-warn-line bg-warn-soft text-xs text-warn" data-testid="raw-unparsed">
      <summary className="cursor-pointer px-2.5 py-1.5 font-bold select-none">
        {label}: {answer.unparsed.length} satır ayrıştırılamadı
      </summary>
      <ul className="space-y-1 px-2.5 pb-2">
        {answer.unparsed.map((u) => (
          <li key={u.line} className="break-words">
            <span className="font-bold">Satır {u.line}</span> ({u.reason}): <span className="font-mono text-white">{u.text}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * "Prompt oluştur": seçili günün maçları için yapay zekâya yapıştırılacak ham veri promptu.
 * Maç seçimi ve numaralar AI ANALİZİ sayfasındaki promptla aynıdır; hiçbir şey kaydedilmez.
 */
function PromptSection({ matches, thresholds, selectedDate }: Pick<ReturnType<typeof useApp>, 'matches' | 'thresholds' | 'selectedDate'>) {
  const [shown, setShown] = useState<number | null>(null)
  const [copied, setCopied] = useState<{ index: number; ok: boolean } | null>(null)
  // AI ANALİZİ sayfasıyla aynı çağrı: aynı maçlar, aynı sıra, aynı numaralar.
  const prompts = useMemo(() => (selectedDate ? buildRawPrompts(collectAiMatches(analyzeDay(matches, thresholds, 'percent')), formatPlainDate(selectedDate)) : []), [matches, thresholds, selectedDate])
  const open = prompts.find((prompt) => prompt.index === shown) ?? null
  const count = prompts.length > 0 ? prompts[prompts.length - 1].to : 0

  return (
    <section className="rounded-xl border border-navy-500 bg-navy-800 p-3" data-testid="raw-prompt">
      <h3 className="text-sm font-extrabold tracking-wide">PROMPT OLUŞTUR</h3>
      {prompts.length === 0 ? (
        <p className="mt-1 text-xs text-muted" data-testid="raw-prompt-empty">
          {selectedDate ? `${formatPlainDate(selectedDate)} için AI ANALİZİ listesinde maç yok; prompt üretilmedi.` : 'Gün seçili değil; prompt üretilmedi.'}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted" data-testid="raw-prompt-info">
            {formatPlainDate(selectedDate!)} · {count} maç (AI ANALİZİ promptundaki maçlar ve numaralar)
            {prompts.length > 1 && ` · ${PROMPT_V3_GROUP_SIZE}’erli ${prompts.length} prompt`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {prompts.map((prompt) => (
              <li key={prompt.index} className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={shown === prompt.index} onClick={() => setShown(shown === prompt.index ? null : prompt.index)} data-testid={`raw-prompt-show-${prompt.index}`} className={`${SECONDARY} ${shown === prompt.index ? 'border-brand text-brand' : ''}`}>
                  Prompt {prompt.index}/{prompt.total}
                </button>
                <span className="text-xs text-muted">
                  #{prompt.from}
                  {prompt.to > prompt.from && `–#${prompt.to}`}
                </span>
                <button type="button" onClick={() => void copyText(prompt.text).then((ok) => setCopied({ index: prompt.index, ok }))} data-testid={`raw-prompt-copy-${prompt.index}`} className={SECONDARY}>
                  Kopyala
                </button>
                {copied?.index === prompt.index && <span className={`text-xs font-semibold ${copied.ok ? 'text-win' : 'text-loss-text'}`}>{copied.ok ? '✓ Kopyalandı' : 'Kopyalanamadı; metni açıp elle kopyalayın'}</span>}
              </li>
            ))}
          </ul>
          {open && <textarea readOnly value={open.text} rows={12} spellCheck={false} onFocus={(e) => e.target.select()} data-testid="raw-prompt-text" className={`${INPUT} mt-2 font-mono text-xs text-white`} />}
        </>
      )}
    </section>
  )
}

export default function RawComparePanel() {
  const { matches, analysis, selectedDate, thresholds } = useApp()
  const [texts, setTexts] = useState<Record<AiId, string>>({ A: '', B: '' })
  const [names, setNames] = useState<Record<AiId, string>>({ A: 'AI A', B: 'AI B' })
  const [copied, setCopied] = useState<boolean | null>(null)

  const labels = useMemo<Record<AiId, string>>(() => ({ A: names.A.trim() || 'AI A', B: names.B.trim() || 'AI B' }), [names])
  const parsed = useMemo<Record<AiId, ParsedAnswer | null>>(() => ({ A: texts.A.trim() ? parseAnswer(texts.A) : null, B: texts.B.trim() ? parseAnswer(texts.B) : null }), [texts])
  const compared = useMemo(() => compareAnswers({ a: parsed.A, b: parsed.B, labels, fixtures: matches.map((m) => ({ id: m.id, home: m.home, away: m.away })) }), [parsed, labels, matches])
  const allWarnings = useMemo(() => warningsText(compared), [compared])

  /** Günün listelerinde bu maçın yer aldığı kategoriler ve yüzdeleri; maç CSV'de yoksa null */
  const suggestionsFor = (fixtureId: string | null) =>
    fixtureId === null
      ? null
      : CATEGORIES.flatMap((category) => {
          const prediction = analysis[category.id].predictions.find((p) => p.match.id === fixtureId)
          return prediction ? [{ label: category.label, percent: prediction.percent }] : []
        })

  const summary = (answer: ParsedAnswer | null): string =>
    answer ? `${answer.last.length} SON · ${answer.totals.length} TOPLAM · ${answer.h2h.length} H2H · ${answer.notes.length} SKOR/HABER · ${answer.sources.length} kaynak` : 'boş'

  return (
    <details className="min-w-0 rounded-2xl border border-line bg-navy-700" data-testid="raw-compare">
      <summary className="cursor-pointer p-4 font-extrabold tracking-wide select-none">HAM VERİ KARŞILAŞTIRMA</summary>
      <div className="px-4 pb-4">
        <p className="text-sm text-muted">
          İki yapay zekânın ham maç verisi cevabını yapıştırın. Oranlar yalnızca LİG satırlarından sayılır; iki cevap birbiriyle ve seçili günün ({selectedDate ? formatPlainDate(selectedDate) : 'gün seçili değil'}) CSV önerileriyle karşılaştırılır. Hiçbir şey kaydedilmez; sayfa yenilenince metinler
          gider. Eksik veri “bilinmiyor” olarak görünür.
        </p>

        <div className="mt-3">
          <PromptSection matches={matches} thresholds={thresholds} selectedDate={selectedDate} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {AIS.map((ai) => (
            <div key={ai} className="min-w-0">
              <label className="block text-xs font-semibold text-muted">
                Etiket
                <input type="text" value={names[ai]} onChange={(e) => setNames({ ...names, [ai]: e.target.value })} maxLength={30} data-testid={`raw-label-${ai}`} className={`${INPUT} mt-1 font-bold text-white`} />
              </label>
              <label className="mt-2 block text-xs font-semibold text-muted">
                Cevap
                <textarea
                  value={texts[ai]}
                  onChange={(e) => setTexts({ ...texts, [ai]: e.target.value })}
                  rows={8}
                  spellCheck={false}
                  placeholder={'#1 | SON | takım | GG.AA.YYYY | rakip | İÇ | 2-1 | İY 1-0 | LİG | kaynak\n#1 | TOPLAM | takım | oynanan 4 | 2-1-1 | 6-4 | 7 puan | lig sırası 3 | kaynak'}
                  data-testid={`raw-text-${ai}`}
                  className={`${INPUT} mt-1 font-mono text-xs whitespace-pre text-white`}
                />
              </label>
              <p className="mt-1 text-xs text-muted" data-testid={`raw-summary-${ai}`}>
                {summary(parsed[ai])}
              </p>
              <Unparsed label={labels[ai]} answer={parsed[ai]} />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY} disabled={allWarnings === ''} onClick={() => void copyText(allWarnings).then(setCopied)} data-testid="raw-copy">
            Tüm uyarıları kopyala
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={texts.A === '' && texts.B === ''}
            onClick={() => {
              setTexts({ A: '', B: '' })
              setCopied(null)
            }}
            data-testid="raw-clear"
          >
            Temizle
          </button>
          {copied !== null && <span className={`text-xs font-semibold ${copied ? 'text-win' : 'text-loss-text'}`}>{copied ? '✓ Kopyalandı' : 'Kopyalanamadı'}</span>}
          {compared.length > 0 && allWarnings === '' && <span className="text-xs text-muted">Kırmızı, sarı ya da mavi uyarı yok.</span>}
        </div>

        {compared.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3" data-testid="raw-matches">
            {compared.map((match, i) => (
              <MatchCard key={`${match.noA}-${match.noB}-${i}`} match={match} labels={labels} suggestions={suggestionsFor(match.fixtureId)} />
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
