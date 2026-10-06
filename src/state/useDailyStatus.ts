import { useEffect, useState } from 'react'
import { analyzeDay } from '../services/analysis/engine'
import { backupStatus, buildChecklist, sinceBackup, type BackupStatus, type Checklist, type DayInput } from '../services/daily/checklist'
import { matchesRepo, picksRepo, resultsRepo, settingsRepo, sharedRepo, uploadsRepo } from '../services/data'
import type { MatchResult, Thresholds } from '../types'
import { shiftDate } from '../utils/format'
import { useApp } from './AppContext'

export interface DailyStatus {
  backup: BackupStatus
  /** Son yedekten sonra girilen skor ve yüklenen CSV sayısı; hiç yedek yoksa null */
  since: { scores: number; uploads: number } | null
  checklist: Checklist
}

async function loadDay(date: string, thresholds: Thresholds, limit: number): Promise<DayInput> {
  const [matches, picks, shared] = await Promise.all([matchesRepo.listByDate(date), picksRepo.listByDate(date), sharedRepo.listByDate(date)])
  // "Önerisi olan maç": günün analizinde en az bir kategoride listelenen maçlar.
  const analysis = analyzeDay(matches, thresholds, 'percent', limit)
  const recommendedIds = [...new Set(Object.values(analysis).flatMap((a) => a.predictions.map((p) => p.match.id)))]
  return { date, matches, recommendedIds, picks, shared }
}

/** Yedek durumu ve günlük kontrol listesi; yalnızca okur. Veri değişince (dataVersion) yenilenir. */
export function useDailyStatus(): DailyStatus | null {
  const { today, dates, thresholds, marketConflictLimit, dataVersion, sharedPicks, results: selectedResults } = useApp()
  const [status, setStatus] = useState<DailyStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const now = new Date()
      const [todayData, yesterdayData, allResults, uploads, lastBackupAt] = await Promise.all([
        loadDay(today, thresholds, marketConflictLimit),
        loadDay(shiftDate(today, -1), thresholds, marketConflictLimit),
        resultsRepo.listAll(),
        uploadsRepo.list(),
        settingsRepo.getLastBackupAt(),
      ])
      if (cancelled) return
      const results: Record<string, MatchResult> = Object.fromEntries(allResults.map((r) => [r.matchId, r]))
      const hasData = dates.length > 0 || uploads.length > 0
      const backup = backupStatus(lastBackupAt, now, hasData)
      setStatus({
        backup,
        since: sinceBackup(lastBackupAt, allResults, uploads),
        checklist: buildChecklist({ now, today: todayData, yesterday: yesterdayData, results, hasData, backup }),
      })
    })()
    return () => {
      cancelled = true
    }
    // sharedPicks ve selectedResults: görsel indirme ve skor girişi dataVersion'ı artırmadan da listeyi tazeler.
  }, [today, dates, thresholds, marketConflictLimit, dataVersion, sharedPicks, selectedResults])

  return status
}
