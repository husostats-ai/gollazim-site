import { useEffect, useRef, useState } from 'react'
import EmptyState from '../components/EmptyState'
import type { CategoryId } from '../config/categories'
import type { MemberPayload } from '../services/member/payload'
import { HOW_TO_READ, HOW_TO_READ_TITLE } from './howToRead'
import MemberCard from './MemberCard'
import MemberHighlights from './MemberHighlights'
import { categoryChoices, dayChip, dayTitle, listFor, PERCENT_LABELS, PERCENT_NOTE, percentKind, secondPercentLabel } from './view'

const CHIP = 'shrink-0 rounded-xl border px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors'
const chipTone = (active: boolean) => (active ? 'border-brand bg-navy-700 text-brand' : 'border-navy-600 text-muted hover:border-navy-500 hover:text-white')

interface Props {
  payload: MemberPayload
  today: string
  /** Açılışta seçili gün ve kategori (verilmezse ilk gün ve ilk dolu liste) */
  initialDay?: number
  initialCategory?: CategoryId
}

/** Günün kategori listeleri: gün seçici, kategori seçici ve salt okunur kartlar. */
export default function MemberAnalysis({ payload, today, initialDay = 0, initialCategory }: Props) {
  const [dayIndex, setDayIndex] = useState(initialDay)
  const [categoryId, setCategoryId] = useState<CategoryId | null>(initialCategory ?? null)
  // Yeni yayında gün sayısı azalmış olabilir.
  const day = payload.days[Math.min(dayIndex, payload.days.length - 1)]
  const choices = categoryChoices(day)
  const list = listFor(day, categoryId)
  // Günler dar ekrana sığmayınca şerit yatay kayar; seçili gün görünür kalır.
  const selectedDay = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedDay.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [day.date])

  return (
    <>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Gün">
        {payload.days.map((d, i) => (
          <button key={d.date} ref={d === day ? selectedDay : undefined} type="button" role="tab" aria-selected={d === day} onClick={() => setDayIndex(i)} data-testid={`member-day-${i}`} className={`${CHIP} ${chipTone(d === day)}`}>
            {dayChip(d.date, today)}
          </button>
        ))}
      </div>
      <h1 className="mt-4 text-xl font-black tracking-tight sm:text-2xl" data-testid="member-day-title">
        {dayTitle(day.date)}
      </h1>
      {/* Sürüm 1-3 paketlerde bu alan yoktur; seçim yoksa kutu çizilmez. */}
      <MemberHighlights highlights={day.highlights ?? []} />

      {list === null ? (
        <div className="mt-4">
          <EmptyState>Bu gün için yayınlanmış öneri yok.</EmptyState>
        </div>
      ) : (
        <>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Kategori">
            {choices.map((choice) => {
              const active = choice.categoryId === list.categoryId
              return (
                <button
                  key={choice.categoryId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategoryId(choice.categoryId)}
                  data-testid={`member-category-${choice.categoryId}`}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${chipTone(active)}`}
                >
                  {choice.label} <span className="font-normal opacity-80">{choice.count}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted">
            {choices.find((c) => c.categoryId === list.categoryId)!.label} · {list.items.length} öneri · Saatler TSİ
          </p>
          <p className="mt-1.5 text-xs text-muted" data-testid="member-percent-note">
            {PERCENT_NOTE}
          </p>
          <details className="mt-2 rounded-xl border border-line bg-navy-800 text-xs text-muted" data-testid="member-howto">
            <summary className="cursor-pointer px-3 py-2 font-bold text-brand select-none">{HOW_TO_READ_TITLE}</summary>
            <div className="space-y-3 px-3 pb-3" data-testid="member-howto-body">
              {HOW_TO_READ.map((item) => (
                <section key={item.title}>
                  <h3 className="font-bold text-white">{item.title}</h3>
                  {item.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="mt-1 leading-relaxed break-words">
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </details>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="member-cards">
            {list.items.map((item, i) => (
              <MemberCard key={`${list.categoryId}:${item.match}`} rank={i + 1} match={day.matches[item.match]} item={item} categoryLabel={choices.find((c) => c.categoryId === list.categoryId)!.label} percentLabel={PERCENT_LABELS[percentKind(list.categoryId)]} secondLabel={secondPercentLabel(list.categoryId)} />
            ))}
          </div>
        </>
      )}
    </>
  )
}
