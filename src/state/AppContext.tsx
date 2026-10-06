import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultThresholds, type CategoryId } from '../config/categories'
import { analyzeDay, type DayAnalysis } from '../services/analysis/engine'
import { DEFAULT_MARKET_CONFLICT_LIMIT } from '../services/analysis/market'
import type { SortMode } from '../services/analysis/types'
import { aiRepo, matchesRepo, picksRepo, resultsRepo, settingsRepo, sharedRepo, storySelectionsRepo } from '../services/data'
import { findActiveShared, recordShare } from '../services/story/shared'
import { selectionsForDate, type DaySelections } from '../services/story/selection'
import type { AiVerdict, Match, MatchResult, Pick, SharedPick, Thresholds } from '../types'
import { todayInAppZone } from '../utils/date'

interface AppState {
  loading: boolean
  today: string
  /** Verisi olan günler, yeniden eskiye */
  dates: string[]
  selectedDate: string | null
  selectDate: (date: string) => void
  matches: Match[]
  /** Seçili günün girilmiş skorları, maç kimliğine göre */
  results: Record<string, MatchResult>
  /** Seçili günün dondurulmuş önerileri */
  picks: Pick[]
  /** Maçın bu kategorideki dondurulmuş önerisi (skor girildiyse) */
  pickFor: (matchId: string, categoryId: CategoryId) => Pick | undefined
  /** Seçili günün yapay zekâ kararları */
  aiVerdicts: AiVerdict[]
  thresholds: Thresholds
  /** Eşikleri kaydeder; analiz hemen yeniden hesaplanır */
  saveThresholds: (thresholds: Thresholds) => Promise<void>
  /** Hazır yüzde ile piyasa yüzdesi arasındaki fark en az bu kadar puansa "piyasa çelişkisi" */
  marketConflictLimit: number
  saveMarketConflictLimit: (limit: number) => Promise<void>
  /** Seçili günde Story görseline girmesi işaretlenen maçlar, kategoriye göre; yalnızca görsel içindir */
  storySelections: DaySelections
  setStorySelection: (categoryId: CategoryId, matchIds: string[]) => void
  /** Seçili günün paylaşılan öneri kayıtları (çıkarılmış olanlar dahil) */
  sharedPicks: SharedPick[]
  /** Görseldeki maçları paylaşıldı olarak kaydeder; yeni eklenen kayıtları döner */
  recordShared: (categoryId: CategoryId, shared: Match[]) => Promise<SharedPick[]>
  /** Geçerli kaydı "çıkarıldı" olarak işaretler */
  removeShared: (categoryId: CategoryId, matchId: string) => Promise<void>
  sortMode: SortMode
  setSortMode: (mode: SortMode) => void
  analysis: DayAnalysis
  /** Veri değiştiğinde (CSV yükleme/silme, yedek, ayar) yeniden okur */
  refresh: () => Promise<void>
  /** Her refresh çağrısında artar; kendi verisini okuyan paneller bunu izler */
  dataVersion: number
}

const AppContext = createContext<AppState | null>(null)
const SORT_MODE_KEY = 'gollazim.sortMode'

const readSortMode = (): SortMode => {
  try {
    return localStorage.getItem(SORT_MODE_KEY) === 'cautious' ? 'cautious' : 'percent'
  } catch {
    return 'percent'
  }
}

/** Bugün verisi varsa bugün; yoksa en yakın geçmiş gün; o da yoksa en yakın gelecek gün. */
export const pickDefaultDate = (dates: string[], today: string): string | null => {
  if (dates.length === 0) return null
  if (dates.includes(today)) return today
  return dates.find((d) => d < today) ?? dates[dates.length - 1]
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [results, setResults] = useState<Record<string, MatchResult>>({})
  const [picks, setPicks] = useState<Pick[]>([])
  const [aiVerdicts, setAiVerdicts] = useState<AiVerdict[]>([])
  const [storySelections, setStorySelections] = useState<DaySelections>({})
  const [sharedPicks, setSharedPicks] = useState<SharedPick[]>([])
  // Seçim yazmaları sırayla yapılır ki art arda işaretlemelerde son durum kalsın.
  const selectionWrites = useRef<Promise<void>>(Promise.resolve())
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds)
  const [marketConflictLimit, setMarketConflictLimit] = useState(DEFAULT_MARKET_CONFLICT_LIMIT)
  const [sortMode, setSortModeState] = useState<SortMode>(readSortMode)
  const [version, setVersion] = useState(0)
  const today = todayInAppZone()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextDates, nextThresholds, nextMarketLimit] = await Promise.all([
        matchesRepo.listDates(),
        settingsRepo.getThresholds(),
        settingsRepo.getMarketConflictLimit(),
      ])
      if (cancelled) return
      const date = selectedDate && nextDates.includes(selectedDate) ? selectedDate : pickDefaultDate(nextDates, today)
      const nextMatches = date ? await matchesRepo.listByDate(date) : []
      const [nextResults, nextPicks, nextVerdicts, nextSelections, nextShared] = await Promise.all([
        resultsRepo.listByMatchIds(nextMatches.map((m) => m.id)),
        date ? picksRepo.listByDate(date) : [],
        date ? aiRepo.listVerdictsByDate(date) : [],
        date ? selectionWrites.current.then(() => storySelectionsRepo.listByDate(date)) : [],
        date ? sharedRepo.listByDate(date) : [],
      ])
      if (cancelled) return
      setDates(nextDates)
      setThresholds(nextThresholds)
      setMarketConflictLimit(nextMarketLimit)
      setSelectedDate(date)
      setMatches(nextMatches)
      setResults(Object.fromEntries(nextResults.map((r) => [r.matchId, r])))
      setPicks(nextPicks)
      setAiVerdicts(nextVerdicts)
      setStorySelections(date ? selectionsForDate(nextSelections, date) : {})
      setSharedPicks(nextShared)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedDate, version, today])

  const refresh = useCallback(async () => setVersion((v) => v + 1), [])

  const saveThresholds = useCallback(async (next: Thresholds) => {
    setThresholds(next)
    await settingsRepo.setThresholds(next)
  }, [])

  const saveMarketConflictLimit = useCallback(async (limit: number) => {
    setMarketConflictLimit(limit)
    await settingsRepo.setMarketConflictLimit(limit)
  }, [])

  const setStorySelection = useCallback(
    (categoryId: CategoryId, matchIds: string[]) => {
      if (!selectedDate) return
      const date = selectedDate
      setStorySelections((current) => ({ ...current, [categoryId]: matchIds }))
      selectionWrites.current = selectionWrites.current
        .then(() => storySelectionsRepo.set(date, categoryId, matchIds))
        // Kayıt başarısız olursa seçim bu oturumda geçerli kalır.
        .catch(() => undefined)
    },
    [selectedDate],
  )

  const recordShared = useCallback(
    async (categoryId: CategoryId, shared: Match[]) => {
      if (!selectedDate) return []
      // Aynı anda iki üretim olsa da çift kayıt açılmasın diye güncel kayıtlar veritabanından okunur.
      const existing = await sharedRepo.listByDate(selectedDate)
      const added = recordShare(existing, { date: selectedDate, categoryId, matches: shared, now: new Date().toISOString() })
      if (added.length > 0) await sharedRepo.addMany(added)
      setSharedPicks([...existing, ...added])
      return added
    },
    [selectedDate],
  )

  const removeShared = useCallback(
    async (categoryId: CategoryId, matchId: string) => {
      if (!selectedDate) return
      const existing = await sharedRepo.listByDate(selectedDate)
      const target = findActiveShared(existing, selectedDate, categoryId, matchId)
      if (target) await sharedRepo.markRemoved(target.id, new Date().toISOString())
      setSharedPicks(await sharedRepo.listByDate(selectedDate))
    },
    [selectedDate],
  )

  const setSortMode = useCallback((mode: SortMode) => {
    setSortModeState(mode)
    try {
      localStorage.setItem(SORT_MODE_KEY, mode)
    } catch {
      // Tercih saklanamazsa sadece bu oturumda geçerli olur.
    }
  }, [])

  const analysis = useMemo(
    () => analyzeDay(matches, thresholds, sortMode, marketConflictLimit),
    [matches, thresholds, sortMode, marketConflictLimit],
  )

  const pickFor = useCallback(
    (matchId: string, categoryId: CategoryId) => picks.find((p) => p.matchId === matchId && p.categoryId === categoryId),
    [picks],
  )

  const value: AppState = {
    loading,
    today,
    dates,
    selectedDate,
    selectDate: setSelectedDate,
    matches,
    results,
    picks,
    pickFor,
    aiVerdicts,
    thresholds,
    saveThresholds,
    marketConflictLimit,
    saveMarketConflictLimit,
    storySelections,
    setStorySelection,
    sharedPicks,
    recordShared,
    removeShared,
    sortMode,
    setSortMode,
    analysis,
    refresh,
    dataVersion: version,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = (): AppState => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp, AppProvider içinde kullanılmalı')
  return ctx
}
