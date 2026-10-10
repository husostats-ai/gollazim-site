import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultThresholds, type CategoryId } from '../config/categories'
import { analyzeDay, type DayAnalysis } from '../services/analysis/engine'
import { DEFAULT_MARKET_CONFLICT_LIMIT } from '../services/analysis/market'
import type { SortMode } from '../services/analysis/types'
import { leagueRepo, aiRepo, aiSharesRepo, highlightsRepo, matchesRepo, picksRepo, resultsRepo, settingsRepo, sharedRepo, storySelectionsRepo } from '../services/data'
import { addHighlight, removeHighlight, type HighlightCandidate, type HighlightRefusal } from '../services/highlights/highlights'
import { findActiveShared, recordShare } from '../services/story/shared'
import type { StreakCandidate, StreakRefusal, StreakView } from '../services/streak/streak'
import { loadStreak, removePendingFromStreak, sendToStreak, takeBackFromStreak, undoStreakRemoval } from '../services/streak/streakService'
import { selectionsForDate, type DaySelections } from '../services/story/selection'
import type { AiShare, AiVerdict, Highlight, LeagueTable, Match, MatchResult, Pick, SharedPick, TeamAlias, Thresholds } from '../types'
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
  /** Seçili günde "AI öneri güveni" satırı üye paketiyle gönderilmiş maçların kaydı */
  aiShares: AiShare[]
  /** Seçili günün "öne çıkan" seçimleri; yalnızca admin sitesindedir */
  highlights: Highlight[]
  /** Öneriyi öne çıkanlara ekler; maç başladıysa ya da saati yoksa reddeder (neden döner) */
  addHighlight: (candidate: HighlightCandidate) => Promise<HighlightRefusal | null>
  /** Seçimi kaldırır (kayıt silinir); maç başladıysa reddeder */
  removeHighlight: (id: string) => Promise<HighlightRefusal | null>
  /** "Seri takibi": tüm adımlar ve onlardan türeyen seriler (güne bağlı değildir); yüklenene dek null */
  streak: StreakView | null
  /** Öneriyi seriye yeni adım olarak gönderir; bekleyen adım varsa ya da maç başladıysa reddeder (neden döner) */
  sendToStreak: (candidate: StreakCandidate) => Promise<StreakRefusal | null>
  /** Adımı siler; maç başladıysa ya da adım yayınlandıysa reddeder */
  takeBackFromStreak: (id: string) => Promise<StreakRefusal | null>
  /** Bekleyen adımı seriden kaldırır (oynanmadı); kayıt durur */
  removePendingFromStreak: (id: string) => Promise<StreakRefusal | null>
  undoStreakRemoval: (id: string) => Promise<StreakRefusal | null>
  /** Yapıştırılan lig tabloları ve takım adı eşleştirmeleri; yalnızca kartta gösterim içindir */
  leagueTables: LeagueTable[]
  teamAliases: TeamAlias[]
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
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [aiShares, setAiShares] = useState<AiShare[]>([])
  const [streak, setStreak] = useState<StreakView | null>(null)
  const [leagueTables, setLeagueTables] = useState<LeagueTable[]>([])
  const [teamAliases, setTeamAliases] = useState<TeamAlias[]>([])
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
      const [nextDates, nextThresholds, nextMarketLimit, nextTables, nextAliases] = await Promise.all([
        matchesRepo.listDates(),
        settingsRepo.getThresholds(),
        settingsRepo.getMarketConflictLimit(),
        leagueRepo.listTables(),
        leagueRepo.listAliases(),
      ])
      if (cancelled) return
      const date = selectedDate && nextDates.includes(selectedDate) ? selectedDate : pickDefaultDate(nextDates, today)
      const nextMatches = date ? await matchesRepo.listByDate(date) : []
      const [nextResults, nextPicks, nextVerdicts, nextSelections, nextShared, nextHighlights, nextAiShares] = await Promise.all([
        resultsRepo.listByMatchIds(nextMatches.map((m) => m.id)),
        date ? picksRepo.listByDate(date) : [],
        date ? aiRepo.listVerdictsByDate(date) : [],
        date ? selectionWrites.current.then(() => storySelectionsRepo.listByDate(date)) : [],
        date ? sharedRepo.listByDate(date) : [],
        date ? highlightsRepo.listByDate(date) : [],
        date ? aiSharesRepo.listByDate(date) : [],
      ])
      if (cancelled) return
      setDates(nextDates)
      setThresholds(nextThresholds)
      setMarketConflictLimit(nextMarketLimit)
      setLeagueTables(nextTables)
      setTeamAliases(nextAliases)
      setSelectedDate(date)
      setMatches(nextMatches)
      setResults(Object.fromEntries(nextResults.map((r) => [r.matchId, r])))
      setPicks(nextPicks)
      setAiVerdicts(nextVerdicts)
      setStorySelections(date ? selectionsForDate(nextSelections, date) : {})
      setSharedPicks(nextShared)
      setHighlights(nextHighlights)
      setAiShares(nextAiShares)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedDate, version, today])

  // Seri güne bağlı değildir: veri her değiştiğinde (skor, yedek, silme) baştan okunur.
  useEffect(() => {
    let cancelled = false
    void loadStreak().then((next) => !cancelled && setStreak(next))
    return () => {
      cancelled = true
    }
  }, [version])

  const refresh = useCallback(async () => setVersion((v) => v + 1), [])

  const streakAction = useCallback(async <T,>(action: (arg: T) => Promise<StreakRefusal | null>, arg: T) => {
    const reason = await action(arg)
    setStreak(await loadStreak())
    return reason
  }, [])
  const sendToStreakAction = useCallback((candidate: StreakCandidate) => streakAction(sendToStreak, candidate), [streakAction])
  const takeBackFromStreakAction = useCallback((id: string) => streakAction(takeBackFromStreak, id), [streakAction])
  const removePendingFromStreakAction = useCallback((id: string) => streakAction(removePendingFromStreak, id), [streakAction])
  const undoStreakRemovalAction = useCallback((id: string) => streakAction(undoStreakRemoval, id), [streakAction])

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

  // Kilit burada, kayıttan hemen önce ve güncel saatle denetlenir: buton pasif olmasa da
  // başlamış maçın seçimi eklenemez ve silinemez.
  const addHighlightAction = useCallback(
    async (candidate: HighlightCandidate) => {
      const date = candidate.match.date
      const result = addHighlight(await highlightsRepo.listByDate(date), candidate, new Date())
      if (result.ok) await highlightsRepo.put(result.record)
      if (date === selectedDate) setHighlights(await highlightsRepo.listByDate(date))
      return result.ok ? null : result.reason
    },
    [selectedDate],
  )

  const removeHighlightAction = useCallback(
    async (id: string) => {
      if (!selectedDate) return 'missing' as const
      const result = removeHighlight(await highlightsRepo.listByDate(selectedDate), id, new Date())
      if (result.ok) await highlightsRepo.remove(id)
      setHighlights(await highlightsRepo.listByDate(selectedDate))
      return result.ok ? null : result.reason
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
    aiShares,
    highlights,
    addHighlight: addHighlightAction,
    removeHighlight: removeHighlightAction,
    streak,
    sendToStreak: sendToStreakAction,
    takeBackFromStreak: takeBackFromStreakAction,
    removePendingFromStreak: removePendingFromStreakAction,
    undoStreakRemoval: undoStreakRemovalAction,
    leagueTables,
    teamAliases,
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
