import type { MemberTexts } from '../../config/memberTexts'
import type { MemberAdminRepo } from '../data/types'
import { keyBackupFileName, openKeyBackup, sealKeyBackup, type KeyBackupFile } from './keyBackup'
import { draftPublication, sealPublication, type Publication, type PublishDraft, type PublishSources } from './publish'
import { checkNewUsername, createMembers, ensureSiteSalt, removeMember, renewPassword, type IssuedLogin } from './registry'
import type { MemberSnapshot } from './types'

// Admin'in üye sayfasıyla ilgili işlemleri: üye kayıt deposu (MemberAdminRepo) üzerinde çalışır.
// Düz şifre yalnızca dönen IssuedLogin içinde bulunur; depoya yazılmaz.

/** Üyeleri oluşturur ve kaydeder. Adlar önceden denetlenmiş olmalıdır; geçersiz ya da dolu ad hata verir. */
export async function addMembers(repo: MemberAdminRepo, usernames: readonly string[], now: string, onProgress?: (done: number, total: number) => void): Promise<IssuedLogin[]> {
  const [existing, meta] = await Promise.all([repo.listMembers(), repo.getMeta()])
  const taken = existing.map((m) => m.username)
  for (const username of usernames) {
    const checked = checkNewUsername(username, taken)
    if (!checked.ok || checked.username !== username) throw new Error(`Kullanıcı adı kullanılamıyor: ${username}`)
    taken.push(username)
  }
  const siteSalt = ensureSiteSalt(meta.siteSalt)
  const { records, issued } = await createMembers(usernames, siteSalt, now, onProgress)
  await repo.putMembers(records)
  await repo.patchMeta({ siteSalt, keysChangedAt: now })
  return issued
}

async function activeMember(repo: MemberAdminRepo, username: string) {
  const record = (await repo.listMembers()).find((m) => m.username === username)
  if (!record || !record.active) throw new Error(`Aktif üye bulunamadı: ${username}`)
  return record
}

/** Üyeyi çıkarır. Çıkarma, bir sonraki yayında etkili olur: yayındaki paket o üyeye hâlâ açıktır. */
export async function removeMemberByName(repo: MemberAdminRepo, username: string, now: string): Promise<void> {
  await repo.putMembers([removeMember(await activeMember(repo, username), now)])
  await repo.patchMeta({ keysChangedAt: now })
}

/** Üyeye yeni şifre üretir. Eski şifre, yeniden yayınlanana dek yayındaki paketi açar. */
export async function renewMemberPassword(repo: MemberAdminRepo, username: string, now: string): Promise<IssuedLogin> {
  const [record, meta] = await Promise.all([activeMember(repo, username), repo.getMeta()])
  const renewed = await renewPassword(record, ensureSiteSalt(meta.siteSalt), now)
  await repo.putMembers([renewed.record])
  await repo.patchMeta({ keysChangedAt: now })
  return renewed.issued
}

export async function saveMemberTexts(repo: MemberAdminRepo, texts: MemberTexts): Promise<void> {
  await repo.patchMeta({ texts })
}

/** Bir sonraki yayının taslağı (onay ekranı için); hiçbir şey kaydetmez. */
export async function previewPublication(repo: MemberAdminRepo, sources: PublishSources, day: string, now: string): Promise<PublishDraft> {
  const meta = await repo.getMeta()
  return draftPublication(sources, { day, n: meta.publishCounter + 1, publishedAt: now, texts: meta.texts })
}

/**
 * Yayınlar: paketi kurar, sızıntı denetiminden geçirir, aktif üyeler için şifreler; yayın
 * numarasını artırır, geçmişe yazar ve pakete giren öne çıkan seçimleri yayınlandı olarak işaretler. Aktif üye yoksa ya da denetim başarısızsa
 * PublishError fırlatır ve hiçbir şey kaydedilmez.
 */
export async function publish(repo: MemberAdminRepo, sources: PublishSources, day: string, now: string): Promise<Publication> {
  const [members, meta] = await Promise.all([repo.listMembers(), repo.getMeta()])
  const draft = await draftPublication(sources, { day, n: meta.publishCounter + 1, publishedAt: now, texts: meta.texts })
  const publication = await sealPublication(draft, members, meta)
  await repo.addPublication(publication.record)
  await repo.patchMeta({ publishCounter: publication.record.n })
  // Pakete giren öne çıkan seçimler artık üyelere açıktır: kaldırılamaz olarak işaretlenir.
  if (draft.highlightIds.length > 0) await sources.markHighlightsPublished(draft.highlightIds, now)
  return publication
}

const snapshotOf = async (repo: MemberAdminRepo): Promise<MemberSnapshot> => {
  const [members, meta, publications] = await Promise.all([repo.listMembers(), repo.getMeta(), repo.listPublications()])
  return { members, siteSalt: meta.siteSalt, publishCounter: meta.publishCounter, texts: meta.texts, publications }
}

/** Üye anahtar yedeğini parolayla şifreler ve son-yedek zamanını kaydeder. */
export async function backupMemberKeys(repo: MemberAdminRepo, passphrase: string, now: string, today: string): Promise<{ file: KeyBackupFile; fileName: string }> {
  const file = await sealKeyBackup(await snapshotOf(repo), passphrase, now)
  await repo.patchMeta({ lastKeyBackupAt: now })
  return { file, fileName: keyBackupFileName(today) }
}

/** Üye anahtar yedeğini yükler: mevcut üye kayıtlarının yerine yedektekiler yazılır. Hata olursa hiçbir şey değişmez. */
export async function restoreMemberKeys(repo: MemberAdminRepo, fileText: string, passphrase: string, now: string): Promise<MemberSnapshot> {
  const { snapshot } = await openKeyBackup(fileText, passphrase)
  await repo.restore(snapshot, now)
  return snapshot
}
