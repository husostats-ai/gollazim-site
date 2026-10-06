import { defaultThresholds } from '../../../config/categories'
import { normalizeStoryTexts } from '../../../config/storyTexts'
import { normalizeMarketConflictLimit } from '../../analysis/market'
import type { Thresholds } from '../../../types'
import type { SettingsRepo } from '../types'
import { db } from './db'

const THRESHOLDS_KEY = 'thresholds'
const STORY_TEXTS_KEY = 'storyTexts'
const MARKET_CONFLICT_LIMIT_KEY = 'marketConflictLimit'

export const settingsRepo: SettingsRepo = {
  async getThresholds() {
    const row = await db.settings.get(THRESHOLDS_KEY)
    // Sonradan eklenen kategoriler kayıtlı ayarda yoksa varsayılanı alır.
    return { ...defaultThresholds(), ...((row?.value as Partial<Thresholds>) ?? {}) }
  },

  async setThresholds(thresholds) {
    await db.settings.put({ key: THRESHOLDS_KEY, value: thresholds })
  },

  async getStoryTexts() {
    return normalizeStoryTexts((await db.settings.get(STORY_TEXTS_KEY))?.value)
  },

  async setStoryTexts(texts) {
    await db.settings.put({ key: STORY_TEXTS_KEY, value: normalizeStoryTexts(texts) })
  },

  async getMarketConflictLimit() {
    return normalizeMarketConflictLimit((await db.settings.get(MARKET_CONFLICT_LIMIT_KEY))?.value)
  },

  async setMarketConflictLimit(limit) {
    await db.settings.put({ key: MARKET_CONFLICT_LIMIT_KEY, value: normalizeMarketConflictLimit(limit) })
  },
}
