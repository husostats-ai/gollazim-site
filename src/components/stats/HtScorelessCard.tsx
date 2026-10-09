import type { HtScorelessStats } from '../../services/stats/htScoreless'
import { LOW_SAMPLE_LIMIT } from '../../services/stats/statsEngine'
import { formatRate } from '../../utils/format'

function Figure({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-xl bg-navy-800 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-extrabold" data-testid={testId}>
        {value}
      </p>
    </div>
  )
}

/** İY 0.5 ÜST önerilen maçlardan ilk yarısı 0-0 bitenlerde 2. yarı: yalnızca geçmiş maçların sayımı. */
export default function HtScorelessCard({ stats }: { stats: HtScorelessStats }) {
  const { scored, excluded, scoreless, over, under, rate, lowSample } = stats
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="text-4xl leading-none font-black" data-testid="ht-scoreless-rate">
          {formatRate(rate)}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 pb-0.5 text-sm text-muted">
          · 2Y 1.5 ÜST olan: {over} / {scoreless} maç
          {scoreless > 0 && lowSample && (
            <span
              className="inline-flex items-center rounded-full border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-warn"
              data-testid="ht-scoreless-low"
            >
              ⚠ az örnek
            </span>
          )}
        </p>
      </div>
      <p className="mt-2 text-sm" data-testid="ht-scoreless-text">
        {scored === 0
          ? 'Bu ölçüde İY 0.5 ÜST önerilip skoru girilmiş maç yok.'
          : scoreless === 0
            ? `İY 0.5 ÜST önerilen ve skoru girilen ${scored} maçın hiçbirinde ilk yarı 0-0 bitmedi.`
            : `İY 0.5 ÜST önerilen ve skoru girilen ${scored} maçtan ${scoreless} tanesinde ilk yarı 0-0 bitti. Bu ${scoreless} maçtan ${over} tanesinde 2Y 1.5 ÜST oldu, ${under} tanesinde olmadı.`}
      </p>
      {scoreless > 0 && lowSample && (
        <p className="mt-2 text-xs text-warn">
          İlk yarısı 0-0 biten maç sayısı {LOW_SAMPLE_LIMIT}'den az (N = {scoreless}); bu oran tesadüfen yüksek veya düşük çıkmış olabilir.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Kapsamdaki maç" value={scored} testId="ht-scoreless-scored" />
        <Figure label="İY 0-0 biten (N)" value={scoreless} testId="ht-scoreless-n" />
        <Figure label="2Y 1.5 ÜST oldu" value={over} testId="ht-scoreless-over" />
        <Figure label="2Y 1.5 ÜST olmadı" value={under} testId="ht-scoreless-under" />
      </div>
      <p className="mt-2 text-xs text-muted">
        Kapsam dışı: <span data-testid="ht-scoreless-excluded">{excluded}</span> öneri (maç tamamlanmadı ya da İY / MS skoru yok).
        İlk yarı 0-0 olduğu için 2. yarı golü maç sonu toplamına eşittir; 2Y 1.5 ÜST, maçın en az 2 golle bitmesidir.
        Geçmiş maçların sayımıdır; genel oran gibi okunmamalı, yalnızca önerilen maçların sonuçlarıdır.
      </p>
    </>
  )
}
