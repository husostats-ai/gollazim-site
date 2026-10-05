import { defaultThresholds } from '../../../config/categories'
import type { Thresholds } from '../../../types'
import type { SettingsRepo } from '../types'
import { db } from './db'

const THRESHOLDS_KEY = 'thresholds'

export const settingsRepo: SettingsRepo = {
  async getThresholds() {
    const row = await db.settings.get(THRESHOLDS_KEY)
    // Sonradan eklenen kategoriler kayıtlı ayarda yoksa varsayılanı alır.
    return { ...defaultThresholds(), ...((row?.value as Partial<Thresholds>) ?? {}) }
  },

  async setThresholds(thresholds) {
    await db.settings.put({ key: THRESHOLDS_KEY, value: thresholds })
  },
}
