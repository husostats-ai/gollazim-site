import { normalizeMemberTexts } from '../../../config/memberTexts'
import type { MemberMeta } from '../../memberAdmin/types'
import type { MemberAdminRepo } from '../types'
import { db } from './db'

const read = async (key: string): Promise<unknown> => (await db.memberMeta.get(key))?.value
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

export const memberAdminRepo: MemberAdminRepo = {
  listMembers: () => db.members.orderBy('username').toArray(),

  async putMembers(records) {
    await db.members.bulkPut(records)
  },

  async getMeta() {
    const [siteSalt, publishCounter, texts, keysChangedAt, lastKeyBackupAt] = await Promise.all(['siteSalt', 'publishCounter', 'texts', 'keysChangedAt', 'lastKeyBackupAt'].map(read))
    return {
      siteSalt: text(siteSalt),
      publishCounter: typeof publishCounter === 'number' && Number.isInteger(publishCounter) && publishCounter > 0 ? publishCounter : 0,
      texts: normalizeMemberTexts(texts),
      keysChangedAt: text(keysChangedAt),
      lastKeyBackupAt: text(lastKeyBackupAt),
    }
  },

  async patchMeta(patch) {
    const rows = (Object.keys(patch) as (keyof MemberMeta)[]).map((key) => ({ key, value: key === 'texts' ? normalizeMemberTexts(patch.texts) : patch[key] }))
    await db.memberMeta.bulkPut(rows)
  },

  listPublications: () => db.publications.orderBy('n').reverse().toArray(),

  async addPublication(record) {
    await db.publications.put(record)
  },

  async restore(snapshot, restoredAt) {
    await db.transaction('rw', db.members, db.memberMeta, db.publications, async () => {
      await Promise.all([db.members.clear(), db.memberMeta.clear(), db.publications.clear()])
      await db.members.bulkPut(snapshot.members)
      await db.publications.bulkPut(snapshot.publications)
      // Yedekten dönen durum yedekle aynıdır: yedek "güncel" sayılır.
      await db.memberMeta.bulkPut([
        { key: 'siteSalt', value: snapshot.siteSalt },
        { key: 'publishCounter', value: snapshot.publishCounter },
        { key: 'texts', value: normalizeMemberTexts(snapshot.texts) },
        { key: 'keysChangedAt', value: restoredAt },
        { key: 'lastKeyBackupAt', value: restoredAt },
      ])
    })
  },
}
