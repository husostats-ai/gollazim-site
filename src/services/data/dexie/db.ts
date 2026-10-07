import Dexie, { type EntityTable } from 'dexie'
import { getCategory } from '../../../config/categories'
import type { AiPromptBatch, AiVerdict, LeagueTable, TeamAlias, Match, MatchResult, Pick, SharedPick, StorySelection, Upload } from '../../../types'
import { assessReliability } from '../../analysis/reliability'
import type { MemberRecord, PublicationRecord } from '../../memberAdmin/types'

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
  storySelections: EntityTable<StorySelection, 'id'>
  sharedPicks: EntityTable<SharedPick, 'id'>
  leagueTables: EntityTable<LeagueTable, 'id'>
  teamAliases: EntityTable<TeamAlias, 'id'>
  members: EntityTable<MemberRecord, 'username'>
  memberMeta: EntityTable<SettingRow, 'key'>
  publications: EntityTable<PublicationRecord, 'n'>
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

// v4: Story görseline girecek maçların gün + kategori bazında seçimi. Mevcut tablolara dokunmaz.
db.version(4).stores({
  storySelections: 'id, date',
})

// v5: paylaşılan öneriler kaydı (Story görselinde yer alan maçlar). Mevcut tablolara dokunmaz.
db.version(5).stores({
  sharedPicks: 'id, date',
})

// v6: yapıştırılan lig tabloları ve takım adı eşleştirmeleri (yalnızca gösterim). Mevcut tablolara dokunmaz.
db.version(6).stores({
  leagueTables: 'id',
  teamAliases: 'id, league',
})

// v7: üye sayfasının admin kayıtları (üyeler, üye ayarları, yayın geçmişi). Mevcut tablolara
// dokunmaz. Bu tablolar normal yedeğe girmez ve normal yedeğin geri yüklenmesinde silinmez.
db.version(7).stores({
  members: 'username',
  memberMeta: 'key',
  publications: 'n',
})
