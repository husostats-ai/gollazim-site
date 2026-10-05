import type { BackupFile, Match, MatchResult, Pick, Thresholds, Upload } from '../../types'

// Uygulamanın geri kalanı sadece bu arayüzleri bilir. Supabase'e geçiş:
// bu arayüzleri uygulayan yeni dosyalar yazıp index.ts'te değiştirmek.

export interface UploadsRepo {
  list(): Promise<Upload[]>
  add(upload: Upload): Promise<void>
  /** Yüklemeyi ve ona bağlı maç, skor ve önerileri siler */
  remove(id: string): Promise<void>
}

export interface MatchesRepo {
  /** Verisi olan günler, yeniden eskiye */
  listDates(): Promise<string[]>
  listByDate(date: string): Promise<Match[]>
  get(id: string): Promise<Match | undefined>
  /** Verilen kimliklerden kayıtlı olan maçlar */
  getMany(ids: string[]): Promise<Match[]>
  countByUpload(uploadId: string): Promise<number>
  upsertMany(matches: Match[]): Promise<void>
  update(id: string, patch: Partial<Omit<Match, 'id'>>): Promise<void>
  /** Maçı, skorunu ve önerilerini siler */
  remove(id: string): Promise<void>
}

export interface ResultsRepo {
  get(matchId: string): Promise<MatchResult | undefined>
  listByMatchIds(matchIds: string[]): Promise<MatchResult[]>
  save(result: MatchResult): Promise<void>
  remove(matchId: string): Promise<void>
}

export interface PicksRepo {
  listAll(): Promise<Pick[]>
  listByDate(date: string): Promise<Pick[]>
  listByMatch(matchId: string): Promise<Pick[]>
  /** Maçın dondurulmuş önerilerini verilen listeyle değiştirir */
  replaceForMatch(matchId: string, picks: Pick[]): Promise<void>
}

export interface SettingsRepo {
  getThresholds(): Promise<Thresholds>
  setThresholds(thresholds: Thresholds): Promise<void>
}

export interface BackupRepo {
  exportAll(): Promise<BackupFile>
  /** Mevcut tüm veriyi yedekteki veriyle değiştirir */
  importAll(backup: BackupFile): Promise<void>
}
