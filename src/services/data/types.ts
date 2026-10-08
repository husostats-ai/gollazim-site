import type { AiProvider } from '../../config/ai'
import type { StoryTexts } from '../../config/storyTexts'
import type { CategoryId } from '../../config/categories'
import type {
  AiPromptBatch,
  AiShare,
  AiVerdict,
  BackupFile,
  Highlight,
  LeagueTable,
  Match,
  MatchResult,
  Pick,
  SharedPick,
  StorySelection,
  TeamAlias,
  Thresholds,
  Upload,
} from '../../types'
import type { MemberMeta, MemberRecord, MemberSnapshot, PublicationRecord } from '../memberAdmin/types'

// Uygulamanın geri kalanı sadece bu arayüzleri bilir. Supabase'e geçiş:
// bu arayüzleri uygulayan yeni dosyalar yazıp index.ts'te değiştirmek.

export interface UploadsRepo {
  list(): Promise<Upload[]>
  add(upload: Upload): Promise<void>
  /** Yüklemeyi ve ona bağlı maç, skor, öneri ve yapay zekâ kararlarını siler */
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
  /** Lig adı -> o ligde CSV'de geçen takım adları (alfabetik) */
  listTeamsByLeague(): Promise<Record<string, string[]>>
  upsertMany(matches: Match[]): Promise<void>
  update(id: string, patch: Partial<Omit<Match, 'id'>>): Promise<void>
  /** Maçı, skorunu, önerilerini ve yapay zekâ kararlarını siler */
  remove(id: string): Promise<void>
}

export interface ResultsRepo {
  listAll(): Promise<MatchResult[]>
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

export interface AiRepo {
  listVerdicts(): Promise<AiVerdict[]>
  listVerdictsByDate(date: string): Promise<AiVerdict[]>
  /** Aynı maç + sağlayıcı için kayıt varsa üzerine yazar */
  saveVerdicts(verdicts: AiVerdict[]): Promise<void>
  removeVerdict(id: string): Promise<void>
  getPromptBatch(date: string, provider: AiProvider): Promise<AiPromptBatch | undefined>
  savePromptBatch(batch: AiPromptBatch): Promise<void>
}

export interface StorySelectionsRepo {
  listAll(): Promise<StorySelection[]>
  listByDate(date: string): Promise<StorySelection[]>
  /** Gün + kategorinin seçimini verilen listeyle değiştirir; boş liste kaydı siler */
  set(date: string, categoryId: CategoryId, matchIds: string[]): Promise<void>
}

export interface LeagueRepo {
  listTables(): Promise<LeagueTable[]>
  /** Ligin tablosunu kaydeder; aynı lig için eski tablo varsa üzerine yazar */
  saveTable(table: LeagueTable): Promise<void>
  listAliases(): Promise<TeamAlias[]>
  saveAliases(aliases: TeamAlias[]): Promise<void>
  removeAlias(id: string): Promise<void>
}

export interface SharedRepo {
  /** Çıkarılmış kayıtlar dahil */
  listAll(): Promise<SharedPick[]>
  listByDate(date: string): Promise<SharedPick[]>
  addMany(records: SharedPick[]): Promise<void>
  /** Kaydı silmez; çıkarıldı olarak işaretler */
  markRemoved(id: string, removedAt: string): Promise<void>
}

export interface HighlightsRepo {
  listByDate(date: string): Promise<Highlight[]>
  put(record: Highlight): Promise<void>
  /** Kaydı siler (kilitlenmeden önce kaldırılan seçim silinmiş sayılır) */
  remove(id: string): Promise<void>
  /** Verilen seçimleri yayınlandı olarak işaretler; daha önce yayınlanmış olanın ilk yayın anı korunur */
  markPublished(ids: string[], publishedAt: string): Promise<void>
}

/** "AI öneri güveni" satırı üyeye giden maçların kaydı. Yalnızca kayıttır; silme işlemi yoktur. */
export interface AiSharesRepo {
  listAll(): Promise<AiShare[]>
  listByDate(date: string): Promise<AiShare[]>
  /** Verilen kimliklerden kayıtlı olanlar */
  getMany(ids: string[]): Promise<AiShare[]>
  putMany(records: AiShare[]): Promise<void>
}

export interface SettingsRepo {
  getThresholds(): Promise<Thresholds>
  setThresholds(thresholds: Thresholds): Promise<void>
  /** Günlük görselin alt metinleri; kayıt yoksa varsayılanlar */
  getStoryTexts(): Promise<StoryTexts>
  setStoryTexts(texts: StoryTexts): Promise<void>
  /** Piyasa çelişkisi sınırı (puan); kayıt yoksa varsayılan */
  getMarketConflictLimit(): Promise<number>
  setMarketConflictLimit(limit: number): Promise<void>
  /** Bu tarayıcıda son JSON yedeğinin alındığı an (ISO); hiç alınmadıysa null. Yedek dosyasına girmez. */
  getLastBackupAt(): Promise<string | null>
  setLastBackupAt(at: string): Promise<void>
}

export interface BackupRepo {
  exportAll(): Promise<BackupFile>
  /** Mevcut tüm veriyi yedekteki veriyle değiştirir */
  importAll(backup: BackupFile): Promise<void>
}

/**
 * Üye sayfasının admin kayıtları. Normal yedeğe (BackupRepo) girmez ve normal yedeğin
 * geri yüklenmesinden etkilenmez; kendi şifreli yedeği vardır.
 */
export interface MemberAdminRepo {
  listMembers(): Promise<MemberRecord[]>
  /** Kayıtları ekler; aynı kullanıcı adı varsa üzerine yazar */
  putMembers(records: MemberRecord[]): Promise<void>
  /** Kayıt yoksa varsayılanlar */
  getMeta(): Promise<MemberMeta>
  patchMeta(patch: Partial<MemberMeta>): Promise<void>
  /** Yeniden eskiye */
  listPublications(): Promise<PublicationRecord[]>
  addPublication(record: PublicationRecord): Promise<void>
  /** Üye anahtar yedeğinden: üye kayıtlarının tamamını yedektekiyle değiştirir */
  restore(snapshot: MemberSnapshot, restoredAt: string): Promise<void>
}
