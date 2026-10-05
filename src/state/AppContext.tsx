import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultThresholds, type CategoryId } from '../config/categories'
import { analyzeDay, type DayAnalysis } from '../services/analysis/engine'
import type { SortMode } from '../services/analysis/types'
import { aiRepo, matchesRepo, picksRepo, resultsRepo, settingsRepo } from '../services/data'
import type { AiVerdict, Match, MatchResult, Pick, Thresholds } from '../types'
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
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds)
  const [sortMode, setSortModeState] = useState<SortMode>(readSortMode)
  const [version, setVersion] = useState(0)
  const today = todayInAppZone()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextDates, nextThresholds] = await Promise.all([matchesRepo.listDates(), settingsRepo.getThresholds()])
      if (cancelled) return
      const date = selectedDate && nextDates.includes(selectedDate) ? selectedDate : pickDefaultDate(nextDates, today)
      const nextMatches = date ? await matchesRepo.listByDate(date) : []
      const [nextResults, nextPicks, nextVerdicts] = await Promise.all([
        resultsRepo.listByMatchIds(nextMatches.map((m) => m.id)),
        date ? picksRepo.listByDate(date) : [],
        date ? aiRepo.listVerdictsByDate(date) : [],
      ])
      if (cancelled) return
      setDates(nextDates)
      setThresholds(nextThresholds)
      setSelectedDate(date)
      setMatches(nextMatches)
      setResults(Object.fromEntries(nextResults.map((r) => [r.matchId, r])))
      setPicks(nextPicks)
      setAiVerdicts(nextVerdicts)
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

  const setSortMode = useCallback((mode: SortMode) => {
    setSortModeState(mode)
    try {
      localStorage.setItem(SORT_MODE_KEY, mode)
    } catch {
      // Tercih saklanamazsa sadece bu oturumda geçerli olur.
    }
  }, [])

  const analysis = useMemo(() => analyzeDay(matches, thresholds, sortMode), [matches, thresholds, sortMode])

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
