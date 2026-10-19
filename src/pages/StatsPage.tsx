import { useEffect, useMemo, useState, type ReactNode } from 'react'
import EmptyState from '../components/EmptyState'
import PageTitle from '../components/PageTitle'
import AiStatsCard from '../components/stats/AiStatsCard'
import DailyStoryPanel from '../components/stats/DailyStoryPanel'
import ScoreStatsCard from '../components/stats/ScoreStatsCard'
import StatsSummaryPanel from '../components/stats/StatsSummaryPanel'
import GoalModelStatsCard from '../components/stats/GoalModelStatsCard'
import HtScorelessCard from '../components/stats/HtScorelessCard'
import LeagueCategoryCard from '../components/stats/LeagueCategoryCard'
import MarketStatsCard from '../components/stats/MarketStatsCard'
import LowSampleBadge from '../components/stats/LowSampleBadge'
import RateBars from '../components/stats/RateBars'
import StatsTable from '../components/stats/StatsTable'
import TrendChart from '../components/stats/TrendChart'
import { CATEGORIES, getCategory } from '../config/categories'
import { MAIN_SCOPE_NOTE, onlyMainCategories } from '../config/mainCategories'
import { DATA_LABELS } from '../services/analysis/reliability'
import { buildLegacyAiStats, buildPreMatchAiStats, MAIN_AI_CATEGORY_IDS, statsMatchIds } from '../services/ai/aiStats'
import { hasGoalModel } from '../services/analysis/goalModel'
import { aiRepo, matchesRepo, picksRepo, resultsRepo, sharedRepo, uploadsRepo } from '../services/data'
import { buildStarStats, recomputedNote } from '../services/stats/starStats'
import { SCOPE_LABELS, sharedPicksOnly, type StatsScope } from '../services/story/shared'
import { buildHtScorelessStats } from '../services/stats/htScoreless'
import { buildLeagueCategoryStats } from '../services/stats/leagueCategoryStats'
import { buildMainStats } from '../services/stats/mainStats'
import { backfillMarket, buildMarketStats } from '../services/stats/marketStats'
import { buildStats, decidedBuckets, LOW_SAMPLE_LIMIT, type Bucket } from '../services/stats/statsEngine'
import { useApp } from '../state/AppContext'
import type { AiVerdict, Match, MatchResult, Pick, SharedPick, Upload } from '../types'
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

function Card({ title, note, testId, children }: { title: string; note?: string; testId?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-navy-700 p-4" data-testid={testId}>
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
  /**
   * Önerisi olan günlerin tüm maç kayıtları: özetteki "sıraya göre başarı" tablosu sırayı bunlardan
   * yeniden hesaplar. Sayfa bunu beklemeden açılır; okunana dek null.
   */
  const [dayMatches, setDayMatches] = useState<Match[] | null>(null)
  const [results, setResults] = useState<MatchResult[]>([])
  const [period, setPeriod] = useState<Period>('daily')
  const [shared, setShared] = useState<SharedPick[]>([])
  /** CSV yüklemeleri: özetteki "türetme" bilgi satırı yükleme zamanını buradan okur */
  const [uploads, setUploads] = useState<Upload[]>([])
  /** Başarı tablolarının hangi öneriler üzerinden hesaplandığı; kalibrasyon kartlarını etkilemez */
  const [scope, setScope] = useState<StatsScope>('all')

  useEffect(() => {
    let stale = false
    void Promise.all([picksRepo.listAll(), resultsRepo.listAll(), aiRepo.listVerdicts()]).then(async ([all, allResults, allVerdicts]) => {
      // Önerisi, girilmiş skoru ya da yapay zekâ kararı olan maçların kayıtları
      setLegacyMatches(await matchesRepo.getMany(statsMatchIds(all, allResults, allVerdicts)))
      setResults(allResults)
      setVerdicts(allVerdicts)
      setPicks(all)
      // Sayfa çizildikten sonra okunur; eski veriyle hesap yapılmasın diye önce boşaltılır.
      setDayMatches(null)
      const days = (await Promise.all([...new Set(all.map((p) => p.date))].map((date) => matchesRepo.listByDate(date)))).flat()
      // Veri bu arada yeniden değiştiyse eski okuma yenisinin üstüne yazılmaz.
      if (!stale) setDayMatches(days)
    })
    void sharedRepo.listAll().then(setShared)
    void uploadsRepo.list().then(setUploads)
    return () => {
      stale = true
    }
  }, [dataVersion])

  const scopedPicks = useMemo(() => (scope === 'shared' ? sharedPicksOnly(picks ?? [], shared) : (picks ?? [])), [scope, picks, shared])
  /** Yalnızca "Kategori bazlı başarı": tüm kategoriler, seçili ölçüde */
  const categoryStats = useMemo(() => buildStats(scopedPicks), [scopedPicks])
  // Diğer bütün kartlar yalnızca ana kategorileri sayar (config/mainCategories); kayıtlar silinmez.
  const mainPicks = useMemo(() => onlyMainCategories(picks ?? []), [picks])
  const scopedMainPicks = useMemo(() => onlyMainCategories(scopedPicks), [scopedPicks])
  // Kalibrasyon ve model/piyasa kartları her zaman (ana kategorilerdeki) tüm dondurulmuş önerileri kullanır.
  const allStats = useMemo(() => buildStats(mainPicks), [mainPicks])
  const stats = useMemo(() => buildStats(scopedMainPicks), [scopedMainPicks])
  const starStats = useMemo(() => buildStarStats(scopedMainPicks), [scopedMainPicks])
  /** En üstteki kart: yalnızca sabit ana kategoriler (config/mainCategories), seçili ölçüde */
  const main = useMemo(() => buildMainStats(scopedPicks), [scopedPicks])
  /** İY 0.5 ÜST önerilip ilk yarısı 0-0 biten maçlarda 2. yarı; seçili ölçüde */
  const htScoreless = useMemo(() => buildHtScorelessStats(scopedPicks, results), [scopedPicks, results])
  /** Lig × ana kategori ve sabit lig grupları; seçili ölçüde */
  const leagueCategory = useMemo(() => buildLeagueCategoryStats(scopedPicks, legacyMatches), [scopedPicks, legacyMatches])
  // Kategori bazlı kararlar ile eski maç geneli kararlar ayrı ölçülür; aynı orana karışmaz.
  // Kategori bazlı kartta yalnızca maç başlamadan önce kaydedilmiş kararlar sayılır.
  const aiCategoryStats = useMemo(() => buildPreMatchAiStats(mainPicks, verdicts, legacyMatches, MAIN_AI_CATEGORY_IDS), [mainPicks, verdicts, legacyMatches])
  const aiLegacyStats = useMemo(() => buildLegacyAiStats(mainPicks, verdicts), [mainPicks, verdicts])
  const marketStats = useMemo(
    () => buildMarketStats(backfillMarket(mainPicks, legacyMatches, marketConflictLimit)),
    [mainPicks, legacyMatches, marketConflictLimit],
  )
  if (picks === null) return <PageTitle title="İSTATİSTİK" />

  const categoryRows = categoryStats.byCategory.map((b) => ({ ...b, label: getCategory(b.key).label }))
  // Sonuçlanmış önerisi olmayan seviye (ana kategorilerde ör. "Piyasa tabanlı", "Ölçülemedi") çizilmez.
  const reliabilityRows = decidedBuckets(stats.byReliability).map((b) => ({ ...b, label: DATA_LABELS[b.key] }))
  const goalModelLabels = CATEGORIES.filter((c) => hasGoalModel(c.id) && mainPicks.some((p) => p.categoryId === c.id)).map((c) => c.label)

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
          <StatsSummaryPanel picks={picks} matches={legacyMatches} dayMatches={dayMatches} results={results} verdicts={verdicts} shared={shared} uploads={uploads} />
        </Card>
      </div>
      {picks.length === 0 ? (
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
                ? `${SCOPE_LABELS.shared}: ana kategoriler, lig bazlı ana kategoriler, kategori, geçmiş veri, yıldız ve zaman tabloları yalnızca Story görselinde paylaşılan dondurulmuş önerileri sayar. Kalibrasyon, model/piyasa ve yapay zekâ kartları her zaman tüm önerileri kullanır.`
                : `${SCOPE_LABELS.all}: tüm dondurulmuş öneriler sayılır.`}
            </p>
          </div>
          <p className="-mt-2 text-xs text-muted" data-testid="stats-main-scope-note">
            {MAIN_SCOPE_NOTE}
          </p>

          <Card title="ANA KATEGORİLER BAŞARISI" testId="main-card" note={main.categories.map((id) => getCategory(id).label).join(' · ')}>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="text-5xl leading-none font-black sm:text-6xl" data-testid="main-rate">
                {formatRate(main.overall.rate)}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 pb-1 text-sm text-muted">
                · <span data-testid="main-decided">{main.overall.decided}</span> öneri ·{' '}
                <span data-testid="main-matches">{main.matches.decided}</span> benzersiz maç
                {main.overall.decided > 0 && main.overall.lowSample && <LowSampleBadge />}
              </p>
            </div>
            {main.overall.decided > 0 && main.overall.lowSample && (
              <p className="mt-2 text-xs text-warn">
                {LOW_SAMPLE_LIMIT}'den az sonuçlanmış öneri var; bu oran henüz güvenilir bir gösterge değil.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Kazanan" value={main.overall.won} />
              <Figure label="Kaybeden" value={main.overall.lost} />
              <Figure label="Değerlendirilemedi" value={main.overall.void} />
              <Figure label="Bekliyor" value={main.overall.pending} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Bu üç kategoride toplam {main.overall.total} dondurulmuş öneri, {main.matches.total} benzersiz maç. Aynı
              maç birden çok kategoride önerilebildiği için öneri sayısı maç sayısından büyüktür. “Değerlendirilemedi”
              ve “bekliyor” başarı oranına girmez.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="KATEGORİ BAZLI BAŞARI" testId="category-card" note="Tüm kategoriler. Çizgili çubuk: az veri (20'den az sonuçlanmış öneri).">
              <RateBars rows={categoryRows} />
              <TableToggle>
                <StatsTable firstColumn="Kategori" rows={categoryRows} />
              </TableToggle>
            </Card>

            <Card
              title="GEÇMİŞ VERİ MİKTARINA GÖRE BAŞARI"
              testId="reliability-card"
              note="Önerinin dondurulduğu andaki “geçmiş veri” rozetine göre (yüzdenin kaç maçlık veriye dayandığı). “Çok” satırında oran belirgin biçimde daha iyiyse rozet işe yarıyor demektir. Sonuçlanmış önerisi olmayan seviye gösterilmez."
            >
              <RateBars rows={reliabilityRows} />
              <TableToggle>
                <StatsTable firstColumn="Geçmiş veri" rows={reliabilityRows} />
              </TableToggle>
            </Card>
          </div>

          <Card
            title={`İY 0.5 ÜST TUTMADIĞINDA 2. YARI · ${scope === 'shared' ? 'Paylaşılan' : 'Tümü'}`}
            testId="ht-scoreless-card"
            note="İLK YARI 0.5 ÜST olarak dondurulmuş önerilerden ilk yarısı 0-0 biten maçlar."
          >
            <HtScorelessCard stats={htScoreless} />
          </Card>

          <Card
            title={`LİG BAZLI ANA KATEGORİLER · ${scope === 'shared' ? 'Paylaşılan' : 'Tümü'}`}
            testId="league-category-card"
            note={`${main.categories.map((id) => getCategory(id).label).join(' · ')}; lig = ülke · lig adı, sabit gruplar ve lig tabanı.`}
          >
            <LeagueCategoryCard stats={leagueCategory} />
          </Card>

          {starStats.byCategory.length > 0 && (
            <Card title="YILDIZ SAYISINA GÖRE BAŞARI" testId="stars-card" note="Yıldız, önerinin dondurulduğu anda kartta görünen değerdir.">
              <RateBars rows={starStats.byStars.map((b) => ({ ...b, label: `${b.key} yıldız` }))} />
              <TableToggle>
                <StatsTable firstColumn="Yıldız" rows={starStats.byStars.map((b) => ({ ...b, label: `${b.key} yıldız` }))} />
              </TableToggle>
              {recomputedNote(starStats) && (
                <p className="mt-2 text-xs text-muted" data-testid="stars-recomputed">
                  {recomputedNote(starStats)}: yıldız kaydı eklenmeden önce dondurulmuş önerilerde yıldız, kayıtlı yüzde,
                  geçmiş veri seviyesi ve model çelişkisinden yeniden bulundu.
                </p>
              )}
              {starStats.missing > 0 && (
                <p className="mt-2 text-xs text-muted" data-testid="stars-missing">
                  {starStats.missing} eski öneride (geçmiş veri seviyesi kayıtlı olmayan) yıldız bulunamadığı için bu
                  tabloya girmez.
                </p>
              )}
            </Card>
          )}

          {allStats.goalModel && (
            <Card
              title="GOL MODELİ: ÇELİŞKİ VE KALİBRASYON"
              testId="goal-model-card"
              note={`${goalModelLabels.join(' ve ')} önerilerinden, model yüzdesi dondurulmuş olanlar.`}
            >
              <GoalModelStatsCard stats={allStats.goalModel} />
            </Card>
          )}

          {marketStats && (
            <Card
              title="PİYASA: ÇELİŞKİ VE KALİBRASYON"
              testId="market-card"
              note="2.5 ÜST, KG VAR ve İLK YARI 0.5 ÜST önerileri. Piyasa yüzdesi: CSV'deki iki yönlü oranın marjdan arındırılmış olasılığı."
            >
              <MarketStatsCard stats={marketStats} limit={marketConflictLimit} />
            </Card>
          )}

          {/* Taraf & Gol kalibrasyon kartı gösterilmez: ana kategori değildir (hesap statsEngine.sideGoals'ta durur). */}

          {aiCategoryStats && (
            <Card
              title="YAPAY ZEKÂ KARARLARI: KATEGORİ BAZLI"
              testId="ai-category-card"
              note={`Burada yalnızca ${MAIN_AI_CATEGORY_IDS.map((id) => getCategory(id).label).join(', ')} kararları ölçülür; her karar yalnızca o maçın o kategorideki dondurulmuş önerisinin sonucuyla ölçülür. Skoru girilmemiş maçlar orana girmez.`}
            >
              <AiStatsCard stats={aiCategoryStats} kind="category" />
            </Card>
          )}

          {aiLegacyStats && (
            <Card
              title="YAPAY ZEKÂ KARARLARI: MAÇ GENELİ (ESKİ)"
              testId="ai-legacy-card"
              note="Kategori bazlı karara geçilmeden önceki kayıtlar. Karar maçın tümüne aittir; başarı o maçın ana kategorilerdeki dondurulmuş önerilerinin sonucuyla ölçülür. Kategori bazlı kararlarla aynı orana karışmaz."
            >
              <AiStatsCard stats={aiLegacyStats} kind="legacy" />
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

          <Card title="ZAMAN İÇİNDE BAŞARI" testId="period-card" note="Tarihler Türkiye saatine göredir; haftalar pazartesi başlar.">
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
