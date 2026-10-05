import Dexie, { type EntityTable } from 'dexie'
import { getCategory } from '../../../config/categories'
import type { AiPromptBatch, AiVerdict, Match, MatchResult, Pick, Upload } from '../../../types'
import { assessReliability } from '../../analysis/reliability'

export interface SettingRow {
  key: string
  value: unknown
}

export const db = new Dexie('gollazim') as Dexie & {
  uploads: EntityTable<Upload, 'id'>
  matches: EntityTable<Match, 'id'>
  results: EntityTable<MatchResult, 'matchId'>
  picks: EntityTable<Pick, 'id'>
  settings: EntityTable<SettingRow, 'key'>
  aiVerdicts: EntityTable<AiVerdict, 'id'>
  aiPrompts: EntityTable<AiPromptBatch, 'id'>
}

db.version(1).stores({
  uploads: 'id, uploadedAt',
  matches: 'id, date, uploadId',
  results: 'matchId',
  picks: 'id, matchId, date, categoryId',
  settings: 'key',
})

// v2: dondurulmuş önerilere güvenilirlik seviyesi eklendi. Eski kayıtlar maçın
// istatistiklerinden yeniden hesaplanır; maç silinmişse "bilinmiyor" kalır.
db.version(2).upgrade(async (tx) => {
  const matches = new Map((await tx.table<Match, string>('matches').toArray()).map((m) => [m.id, m]))
  await tx
    .table<Pick, string>('picks')
    .toCollection()
    .modify((pick) => {
      if (pick.reliability) return
      const match = matches.get(pick.matchId)
      if (!match) pick.reliability = 'unknown'
      else if (getCategory(pick.categoryId).sampleUnmeasured) pick.reliability = 'unmeasured'
      else pick.reliability = assessReliability(match).level
    })
})

// v3: yapay zekâ kararları ve kopyalanan prompt'ların numaralandırması.
db.version(3).stores({
  aiVerdicts: 'id, matchId, date, provider',
  aiPrompts: 'id, date',
})
