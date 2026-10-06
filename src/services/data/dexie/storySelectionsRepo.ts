import { selectionId } from '../../story/selection'
import type { StorySelectionsRepo } from '../types'
import { db } from './db'

export const storySelectionsRepo: StorySelectionsRepo = {
  listAll: () => db.storySelections.toArray(),

  listByDate: (date) => db.storySelections.where('date').equals(date).toArray(),

  async set(date, categoryId, matchIds) {
    const id = selectionId(date, categoryId)
    // Boş seçim kayıt tutmaz: varsayılan durum "hiçbir maç seçili değil"dir.
    if (matchIds.length === 0) await db.storySelections.delete(id)
    else await db.storySelections.put({ id, date, categoryId, matchIds: [...new Set(matchIds)] })
  },
}
