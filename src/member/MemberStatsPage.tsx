import { useState, type ReactNode } from 'react'
import EmptyState from '../components/EmptyState'
import PageTitle from '../components/PageTitle'
import { CHART } from '../components/stats/chartTheme'
import type { ReliabilityLevel } from '../services/analysis/types'
import { MEMBER_RELIABILITY_LABELS } from '../services/member/labels'
import type { MemberBucket, MemberPayload, MemberTally } from '../services/member/payload'
import { formatDay, formatMonth, formatRate, formatWeek } from '../utils/format'
import { categoryLabel } from './view'

// Üye istatistik sayfası: paketteki ÖNCEDEN HESAPLANMIŞ değerleri gösterir, hesap yapmaz.

type Scope = 'all' | 'shared'
type Period = 'daily' | 'weekly' | 'monthly'

const SCOPES: { id: Scope; label: string; note: string }[] = [
  { id: 'all', label: 'Tümü', note: 'Sonuçlanan tüm öneriler sayılır.' },
  { id: 'shared', label: 'Paylaşılan', note: 'Yalnızca sosyal medyada paylaşılan öneriler sayılır.' },
]
const PERIODS: { id: Period; label: string; column: string; format: (key: string) => string }[] = [
  { id: 'daily', label: 'Günlük', column: 'Gün', format: formatDay },
  { id: 'weekly', label: 'Haftalık', column: 'Hafta (Pzt – Paz)', format: formatWeek },
  { id: 'monthly', label: 'Aylık', column: 'Ay', format: formatMonth },
]

interface Row {
  key: string
  label: string
  tally: MemberTally
}

const HATCH = `repeating-linear-gradient(45deg, ${CHART.mark} 0 3px, ${CHART.surface} 3px 6px)`
const TOGGLE = 'rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors'
const toggleTone = (active: boolean) => (active ? 'bg-brand text-navy-950' : 'text-muted hover:text-white')

const LowSample = () => (
  <span className="inline-flex items-center rounded-full border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-warn">⚠ az veri</span>
)

function Rate({ tally }: { tally: MemberTally }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap">
      <span className="font-bold">{formatRate(tally.rate)}</span>
      <span className="text-muted">· {tally.decided} öneri</span>
      {tally.decided > 0 && tally.lowSample && <LowSample />}
    </span>
  )
}

function Card({ title, note, testId, children }: { title: string; note?: string; testId?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid={testId}>
      <h2 className="font-extrabold tracking-wide">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Bars({ rows }: { rows: Row[] }) {
  return (
    <ul className="space-y-3">
      {rows.map(({ key, label, tally }) => (
        <li key={key}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="min-w-0 font-semibold break-words">{label}</span>
            <Rate tally={tally} />
          </div>
          <div className="mt-1 h-3.5 w-full rounded-r bg-navy-800" role="presentation">
            {tally.rate !== null && tally.rate > 0 && <div className="h-full rounded-r" style={{ width: `${tally.rate}%`, background: tally.lowSample ? HATCH : CHART.mark }} />}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Tuttu {tally.won} · Tutmadı {tally.lost}
            {tally.void > 0 && ` · Değerlendirilemedi ${tally.void}`}
            {tally.pending > 0 && ` · Bekliyor ${tally.pending}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

function Table({ firstColumn, rows }: { firstColumn: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-semibold">{firstColumn}</th>
            <th className="py-2 pr-3 font-semibold">Başarı</th>
            <th className="py-2 pr-3 text-right font-semibold">Tuttu</th>
            <th className="py-2 text-right font-semibold">Tutmadı</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map(({ key, label, tally }) => (
            <tr key={key} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-3 font-semibold">
                {label}
              </th>
              <td className="py-2 pr-3">
                <Rate tally={tally} />
              </td>
              <td className="py-2 pr-3 text-right">{tally.won}</td>
              <td className="py-2 text-right">{tally.lost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-navy-800 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  )
}

const rowsOf = (buckets: MemberBucket[], label: (key: string) => string): Row[] => buckets.map((b) => ({ key: b.key, label: label(b.key), tally: b.tally }))

export default function MemberStatsPage({ payload, initialScope = 'all', initialPeriod = 'daily' }: { payload: MemberPayload; initialScope?: Scope; initialPeriod?: Period }) {
  const [scope, setScope] = useState<Scope>(initialScope)
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const stats = payload.statistics[scope]
  const { overall } = stats
  // En üstteki kart: paket ana kategorileri taşıyorsa onları, taşımıyorsa (eski paket) tüm kategorileri gösterir.
  const main = stats.main
  const top = main ?? { overall, matches: stats.matches }
  const activePeriod = PERIODS.find((p) => p.id === period)!

  return (
    <>
      <PageTitle title="İSTATİSTİK" subtitle="Yalnızca sonuçlanan öneriler sayılır. Başarı = tutan / (tutan + tutmayan)." />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Ölçü">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => setScope(s.id)} data-testid={`member-scope-${s.id}`} className={`${TOGGLE} ${toggleTone(scope === s.id)}`}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 text-xs text-muted" data-testid="member-scope-note">
          {SCOPES.find((s) => s.id === scope)!.note}
        </p>
      </div>

      {overall.total === 0 ? (
        <div className="mt-4">
          <EmptyState>Bu ölçüde henüz sonuçlanan öneri yok.</EmptyState>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Card title={main ? 'ANA KATEGORİLER BAŞARISI' : 'GENEL BAŞARI'} testId="member-top-card" note={main ? main.categories.map(categoryLabel).join(' · ') : undefined}>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-5xl leading-none font-black sm:text-6xl" data-testid="member-overall">
                {formatRate(top.overall.rate)}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 pb-1 text-sm text-muted">
                · {top.overall.decided} öneri · {top.matches.decided} benzersiz maç
                {top.overall.decided > 0 && top.overall.lowSample && <LowSample />}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Tuttu" value={top.overall.won} />
              <Figure label="Tutmadı" value={top.overall.lost} />
              <Figure label="Değerlendirilemedi" value={top.overall.void} />
              <Figure label="Bekliyor" value={top.overall.pending} />
            </div>
            <p className="mt-2 text-xs text-muted">Aynı maç birden çok kategoride önerilebilir. “Değerlendirilemedi” ve “bekliyor” başarıya girmez.</p>
            {main && (
              <p className="mt-3 border-t border-line pt-2 text-xs text-muted" data-testid="member-all-line">
                Tüm kategoriler: {formatRate(overall.rate)} · {overall.decided} öneri · {stats.matches.decided} benzersiz maç
              </p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="KATEGORİ BAZLI BAŞARI" note="Çizgili çubuk: az veri (henüz az sayıda sonuçlanan öneri).">
              <Bars rows={rowsOf(stats.byCategory, categoryLabel)} />
            </Card>
            <Card title="GEÇMİŞ VERİ MİKTARINA GÖRE BAŞARI" note="Geçmiş veri: yüzdenin kaç maçlık veriye dayandığı (önerinin sonuçlandığı andaki seviye). Maçın sonucuna güveni anlatmaz.">
              <Bars rows={rowsOf(stats.byReliability, (key) => MEMBER_RELIABILITY_LABELS[key as ReliabilityLevel] ?? key)} />
            </Card>
          </div>

          {stats.stars.byCategory.length > 0 && (
            <Card title="YILDIZ SAYISINA GÖRE BAŞARI">
              <Bars rows={rowsOf(stats.stars.byStars, (key) => `${key} yıldız`)} />
            </Card>
          )}

          <Card title="ZAMAN İÇİNDE BAŞARI" note="Tarihler Türkiye saatine göredir; haftalar pazartesi başlar.">
            <div className="mb-3 inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Dönem">
              {PERIODS.map((p) => (
                <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} data-testid={`member-period-${p.id}`} className={`${TOGGLE} ${toggleTone(period === p.id)}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <Table firstColumn={activePeriod.column} rows={rowsOf([...stats[period]].reverse(), activePeriod.format)} />
          </Card>
        </div>
      )}
    </>
  )
}
