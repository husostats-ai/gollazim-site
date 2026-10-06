import { useEffect, useMemo, useState, type ReactNode } from 'react'
import EmptyState from '../components/EmptyState'
import PageTitle from '../components/PageTitle'
import AiStatsCard from '../components/stats/AiStatsCard'
import DailyStoryPanel from '../components/stats/DailyStoryPanel'
import ScoreStatsCard from '../components/stats/ScoreStatsCard'
import StatsSummaryPanel from '../components/stats/StatsSummaryPanel'
import GoalModelStatsCard from '../components/stats/GoalModelStatsCard'
import MarketStatsCard from '../components/stats/MarketStatsCard'
import LowSampleBadge from '../components/stats/LowSampleBadge'
import RateBars from '../components/stats/RateBars'
import SideGoalsStatsCard from '../components/stats/SideGoalsStatsCard'
import StatsTable from '../components/stats/StatsTable'
import TrendChart from '../components/stats/TrendChart'
import { getCategory, GROUPS } from '../config/categories'
import { RELIABILITY_LABELS } from '../services/analysis/reliability'
import { buildAiStats } from '../services/ai/aiStats'
import { aiRepo, matchesRepo, picksRepo, resultsRepo, sharedRepo } from '../services/data'
import { buildStarStats, recomputedNote } from '../services/stats/starStats'
import { SCOPE_LABELS, sharedPicksOnly, type StatsScope } from '../services/story/shared'
import { backfillMarket, buildMarketStats } from '../services/stats/marketStats'
import { buildStats, LOW_SAMPLE_LIMIT, type Bucket } from '../services/stats/statsEngine'
import { useApp } from '../state/AppContext'
import type { AiVerdict, Match, MatchResult, Pick, SharedPick } from '../types'
import { formatDateChip, formatDay, formatMonth, formatRate, formatWeek } from '../utils/format'

type Period = 'daily' | 'weekly' | 'monthly'

const PERIODS: { id: Period; label: string; column: string }[] = [
  { id: 'daily', label: 'Günlük', column: 'Gün' },
  { id: 'weekly', label: 'Haftalık', column: 'Hafta (Pzt – Paz)' },
  { id: 'monthly', label: 'Aylık', column: 'Ay' },
]

const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortMonth = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const utc = (date: string) => new Date(`${date}T00:00:00Z`)

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4">
      <h2 className="font-extrabold tracking-wide">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
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

function TableToggle({ children }: { children: ReactNode }) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs font-bold text-brand">Tablo olarak göster</summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

export default function StatsPage() {
  const { dataVersion, today, marketConflictLimit } = useApp()
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [verdicts, setVerdicts] = useState<AiVerdict[]>([])
  /** Önerilerin maç kayıtları: geriye dönük piyasa yüzdesi ve özet / CSV için */
  const [legacyMatches, setLegacyMatches] = useState<Match[]>([])
  const [results, setResults] = useState<MatchResult[]>([])
  const [period, setPeriod] = useState<Period>('daily')
  const [shared, setShared] = useState<SharedPick[]>([])
  /** Başarı tablolarının hangi öneriler üzerinden hesaplandığı; kalibrasyon kartlarını etkilemez */
  const [scope, setScope] = useState<StatsScope>('all')

  useEffect(() => {
    void Promise.all([picksRepo.listAll(), resultsRepo.listAll()]).then(async ([all, allResults]) => {
      // Önerisi ya da girilmiş skoru olan maçların kayıtları
      setLegacyMatches(await matchesRepo.getMany([...new Set([...all.map((p) => p.matchId), ...allResults.map((r) => r.matchId)])]))
      setResults(allResults)
      setPicks(all)
    })
    void aiRepo.listVerdicts().then(setVerdicts)
    void sharedRepo.listAll().then(setShared)
  }, [dataVersion])

  // Kalibrasyon ve model/piyasa kartları her zaman tüm dondurulmuş önerileri kullanır.
  const allStats = useMemo(() => buildStats(picks ?? []), [picks])
  const stats = useMemo(
    () => (scope === 'shared' ? buildStats(sharedPicksOnly(picks ?? [], shared)) : allStats),
    [scope, picks, shared, allStats],
  )
  const scopedPicks = useMemo(() => (scope === 'shared' ? sharedPicksOnly(picks ?? [], shared) : (picks ?? [])), [scope, picks, shared])
  const starStats = useMemo(() => buildStarStats(scopedPicks), [scopedPicks])
  const aiStats = useMemo(() => buildAiStats(picks ?? [], verdicts), [picks, verdicts])
  const marketStats = useMemo(
    () => buildMarketStats(backfillMarket(picks ?? [], legacyMatches, marketConflictLimit)),
    [picks, legacyMatches, marketConflictLimit],
  )
  if (picks === null) return <PageTitle title="İSTATİSTİK" />

  const { overall } = stats
  const categoryRows = stats.byCategory.map((b) => ({ ...b, label: getCategory(b.key).label }))
  const reliabilityRows = stats.byReliability.map((b) => ({ ...b, label: RELIABILITY_LABELS[b.key] }))

  const labelFor: Record<Period, (b: Bucket) => { label: string; shortLabel: string }> = {
    daily: (b) => ({
      label: `${formatDay(b.key)}${b.key === today ? ' (bugün)' : ''}`,
      shortLabel: b.key === today ? formatDateChip(b.key, today) : dayMonth.format(utc(b.key)),
    }),
    weekly: (b) => ({ label: formatWeek(b.key), shortLabel: dayMonth.format(utc(b.key)) }),
    monthly: (b) => ({ label: formatMonth(b.key), shortLabel: shortMonth.format(utc(`${b.key}-01`)) }),
  }
  const periodRows = stats[period].map((b) => ({ ...b, ...labelFor[period](b) }))
  const activePeriod = PERIODS.find((p) => p.id === period)!

  return (
    <>
      <PageTitle
        title="İSTATİSTİK"
        subtitle="Yalnızca skoru girilip dondurulmuş öneriler sayılır. Başarı oranı = kazanan / (kazanan + kaybeden)."
      />
      <div className="mb-4">
        <Card
          title="ANALİZ İÇİN ÖZET"
          note="İstatistiklerin düz metin özeti; bir yapay zekâ sohbetine yapıştırıp yorumlatmak için. Sayılar aşağıdaki tablolarla aynıdır ve Tümü / Paylaşılan geçişinden etkilenmez."
        >
          <StatsSummaryPanel picks={picks} matches={legacyMatches} results={results} verdicts={verdicts} shared={shared} />
        </Card>
      </div>
      {allStats.overall.total === 0 ? (
        <EmptyState>
          Henüz sonuçlanmış öneri yok. Skor Girişi sayfasından maç sonuçlarını “Tamamlandı” olarak kaydedin.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Ölçü">
              {(['all', 'shared'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                  data-testid={`stats-scope-${id}`}
                  className={`rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
                    scope === id ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
                  }`}
                >
                  {id === 'all' ? 'Tümü' : 'Paylaşılan'}
                </button>
              ))}
            </div>
            <p className="min-w-0 text-xs text-muted" data-testid="stats-scope-note">
              {scope === 'shared'
                ? `${SCOPE_LABELS.shared}: genel başarı, kategori, güvenilirlik ve zaman tabloları yalnızca Story görselinde paylaşılan dondurulmuş önerileri sayar. Kalibrasyon, model/piyasa ve yapay zekâ kartları her zaman tüm önerileri kullanır.`
                : `${SCOPE_LABELS.all}: tüm dondurulmuş öneriler sayılır.`}
            </p>
          </div>

          <Card title="GENEL BAŞARI">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-5xl leading-none font-black sm:text-6xl" data-testid="overall-rate">
                {formatRate(overall.rate)}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 pb-1 text-sm text-muted">
                · {overall.decided} öneri · <span data-testid="unique-matches">{stats.matches.decided}</span> benzersiz
                maç
                {overall.decided > 0 && overall.lowSample && <LowSampleBadge />}
              </p>
            </div>
            {overall.decided > 0 && overall.lowSample && (
              <p className="mt-2 text-xs text-warn">
                {LOW_SAMPLE_LIMIT}'den az sonuçlanmış öneri var; bu oran henüz güvenilir bir gösterge değil.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Kazanan" value={overall.won} />
              <Figure label="Kaybeden" value={overall.lost} />
              <Figure label="Değerlendirilemedi" value={overall.void} />
              <Figure label="Bekliyor" value={overall.pending} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Toplam {overall.total} dondurulmuş öneri, {stats.matches.total} benzersiz maç. Aynı maç birden çok
              kategoride önerilebildiği için öneri sayısı maç sayısından büyüktür. “Değerlendirilemedi” ve “bekliyor”
              başarı oranına girmez.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="KATEGORİ BAZLI BAŞARI" note="Çizgili çubuk: az veri (20'den az sonuçlanmış öneri).">
              <RateBars rows={categoryRows} />
              <TableToggle>
                <StatsTable firstColumn="Kategori" rows={categoryRows} />
              </TableToggle>
            </Card>

            <Card
              title="VERİ GÜVENİLİRLİĞİNE GÖRE BAŞARI"
              note="Önerinin dondurulduğu andaki güvenilirlik rozetine göre. Yüksek güvenilirlikte oran belirgin biçimde daha iyiyse rozet işe yarıyor demektir."
            >
              <RateBars rows={reliabilityRows} />
              <TableToggle>
                <StatsTable firstColumn="Güvenilirlik" rows={reliabilityRows} />
              </TableToggle>
            </Card>
          </div>

          {starStats.byCategory.length > 0 && (
            <Card title="YILDIZ SAYISINA GÖRE BAŞARI" note="Yıldız, önerinin dondurulduğu anda kartta görünen değerdir.">
              <RateBars rows={starStats.byStars.map((b) => ({ ...b, label: `${b.key} yıldız` }))} />
              <TableToggle>
                <StatsTable firstColumn="Yıldız" rows={starStats.byStars.map((b) => ({ ...b, label: `${b.key} yıldız` }))} />
              </TableToggle>
              {recomputedNote(starStats) && (
                <p className="mt-2 text-xs text-muted" data-testid="stars-recomputed">
                  {recomputedNote(starStats)}: yıldız kaydı eklenmeden önce dondurulmuş önerilerde yıldız, kayıtlı yüzde,
                  güvenilirlik ve model çelişkisinden yeniden bulundu.
                </p>
              )}
              {starStats.missing > 0 && (
                <p className="mt-2 text-xs text-muted" data-testid="stars-missing">
                  {starStats.missing} eski öneride (Taraf & Gol ya da güvenilirliği kayıtlı olmayan) yıldız bulunamadığı için bu
                  tabloya girmez.
                </p>
              )}
            </Card>
          )}

          {allStats.goalModel && (
            <Card
              title="GOL MODELİ: ÇELİŞKİ VE KALİBRASYON"
              note="2.5 Üst, 3.5 Üst, 4.5 Üst ve KG Var önerilerinden, model yüzdesi dondurulmuş olanlar."
            >
              <GoalModelStatsCard stats={allStats.goalModel} />
            </Card>
          )}

          {marketStats && (
            <Card
              title="PİYASA: ÇELİŞKİ VE KALİBRASYON"
              note="2.5 / 3.5 / 4.5 Üst, KG Var, İlk Yarı 0.5 / 1.5 Üst, 2. Yarı 0.5 Üst ve Korner önerileri. Piyasa yüzdesi: CSV'deki iki yönlü oranın marjdan arındırılmış olasılığı."
            >
              <MarketStatsCard stats={marketStats} limit={marketConflictLimit} />
            </Card>
          )}

          {allStats.sideGoals && (
            <Card
              title={`${GROUPS.find((g) => g.id === 'sidegoals')!.label}: ÇELİŞKİ VE KALİBRASYON`}
              note="Yalnızca Taraf & Gol listelerindeki dondurulmuş öneriler."
            >
              <SideGoalsStatsCard stats={allStats.sideGoals} />
            </Card>
          )}

          {aiStats && (
            <Card
              title="YAPAY ZEKÂ KARARLARININ BAŞARISI"
              note="Karar maç bazındadır; başarı o maçın dondurulmuş önerilerinin sonucuyla ölçülür. Skoru girilmemiş maçlar orana girmez."
            >
              <AiStatsCard stats={aiStats} />
            </Card>
          )}

          <Card
            title="GÜNLÜK GÖRSEL"
            note="Seçilen günün 5 ana kategorideki sonuçlarını özetleyen 1080 × 1920 Instagram Story görseli (PNG). Alttaki Telegram, Instagram ve uyarı metinleri Admin sayfasından düzenlenir."
          >
            <DailyStoryPanel picks={picks} shared={shared} />
          </Card>

          <Card
            title="SKOR TAHMİNLERİ (DENEY)"
            note="Skor modelinin ve yapay zekâların tahmin ettiği skor ile girilen gerçek skor. İç kullanım içindir; görsellere ve paylaşım metinlerine girmez."
          >
            <ScoreStatsCard matches={legacyMatches} results={results} verdicts={verdicts} />
          </Card>

          <Card title="ZAMAN İÇİNDE BAŞARI" note="Tarihler Türkiye saatine göredir; haftalar pazartesi başlar.">
            <div className="mb-3 inline-flex rounded-xl border border-navy-600 bg-navy-800 p-0.5" role="group" aria-label="Dönem">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={period === p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors ${
                    period === p.id ? 'bg-brand text-navy-950' : 'text-muted hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <TrendChart key={period} points={periodRows} />
            <div className="mt-4">
              <StatsTable firstColumn={activePeriod.column} rows={[...periodRows].reverse()} />
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
