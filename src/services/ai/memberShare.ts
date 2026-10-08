import { AI_PROVIDERS, isApproved, type AiDecision, type AiProvider } from '../../config/ai'
import type { AiShare, AiVerdict, Match } from '../../types'
import { kickoffOf } from '../highlights/highlights'
import { summarizeVerdicts } from './consensus'

// Üye kartındaki "AI öneri güveni" satırı: hangi maçın satırının üyeye gideceği burada belirlenir.
// Çoğunluk hesabı consensus.ts'tekiyle aynıdır (ortalama yok). Admin'deki kararlar, rozetler ve
// istatistik bu dosyadan etkilenmez; yalnızca üye paketi ve "üyeye gider" işareti bunu kullanır.

export interface MemberShareVote {
  provider: AiProvider
  decision: Exclude<AiDecision, 'reject'>
}

/** Üyeye giden satır: üç yapay zekânın karar seviyesi ve çoğunluk özeti. Gerekçe, risk, skor yoktur. */
export interface MemberShareRow {
  /** AI_PROVIDERS sırasıyla, her yapay zekâdan bir karar */
  votes: MemberShareVote[]
  /** Çoğunluk kararını veren yapay zekâ sayısı (2 ya da 3) */
  count: number
  decision: 'strong' | 'medium'
}

/**
 * Maçın satırı üyeye gider mi? Şartların hepsi birlikte aranır:
 * - maçın başlama saati biliniyor,
 * - üç yapay zekânın da kararı var ve hepsi maç başlamadan önce kaydedilmiş,
 * - hiçbiri "Eleme" dememiş,
 * - çoğunluk kararı (3/3 ya da 2/3) Orta ya da Güçlü.
 * Biri eksikse null döner ve pakete hiçbir şey yazılmaz.
 */
export function memberShareRow(match: Pick<Match, 'date' | 'time'>, verdicts: readonly AiVerdict[]): MemberShareRow | null {
  const kickoff = kickoffOf(match)
  if (!kickoff) return null
  const votes: MemberShareVote[] = []
  for (const { id } of AI_PROVIDERS) {
    const verdict = verdicts.find((v) => v.provider === id)
    if (!verdict || verdict.decision === 'reject') return null
    const savedAt = Date.parse(verdict.savedAt)
    // Maç başladıktan sonra (ya da zamanı okunamayan) kaydedilmiş karar üyeye gitmez.
    if (Number.isNaN(savedAt) || savedAt >= kickoff.getTime()) return null
    votes.push({ provider: id, decision: verdict.decision })
  }
  const summary = summarizeVerdicts(votes)
  if (!summary?.decision || !isApproved(summary.decision) || summary.decision === 'weak' || summary.decision === 'reject') return null
  return { votes, count: summary.votes, decision: summary.decision }
}

export const aiShareId = (matchId: string): string => matchId

/**
 * Bu yayında satırı üyeye giden maçların kaydı. Maç daha önce de gittiyse ilk gönderim bilgisi
 * korunur; son gönderim ve gönderilen kararların kopyası güncellenir. Verilmeyen kayıtlara dokunulmaz.
 */
export function recordAiShares(
  existing: readonly AiShare[],
  sent: readonly { matchId: string; date: string; row: MemberShareRow }[],
  n: number,
  publishedAt: string,
): AiShare[] {
  const byId = new Map(existing.map((record) => [record.id, record]))
  return sent.map(({ matchId, date, row }) => {
    const before = byId.get(aiShareId(matchId))
    return {
      id: aiShareId(matchId),
      matchId,
      date,
      firstN: before ? before.firstN : n,
      firstAt: before ? before.firstAt : publishedAt,
      lastN: n,
      lastAt: publishedAt,
      votes: row.votes.map((vote) => ({ provider: vote.provider, decision: vote.decision })),
      count: row.count,
      decision: row.decision,
    }
  })
}

const VOTE_DECISIONS: readonly string[] = ['strong', 'medium', 'weak']

/** Yedekten gelen kayıtları doğrular; bozuk satırlar atılır, yinelenen maçta son satır kalır */
export function normalizeAiShares(value: unknown): AiShare[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, AiShare>()
  for (const row of value as Partial<AiShare>[]) {
    if (typeof row !== 'object' || row === null) continue
    const { matchId, date, firstN, firstAt, lastN, lastAt, votes, count, decision } = row
    if (typeof matchId !== 'string' || typeof date !== 'string') continue
    if (!Number.isInteger(firstN) || !Number.isInteger(lastN) || typeof firstAt !== 'string' || typeof lastAt !== 'string') continue
    if (Number.isNaN(Date.parse(firstAt)) || Number.isNaN(Date.parse(lastAt))) continue
    if (decision !== 'strong' && decision !== 'medium') continue
    if (!Array.isArray(votes) || votes.length !== AI_PROVIDERS.length) continue
    const clean = votes.map((vote, i) =>
      typeof vote === 'object' && vote !== null && vote.provider === AI_PROVIDERS[i].id && VOTE_DECISIONS.includes(vote.decision) ? { provider: vote.provider, decision: vote.decision } : null,
    )
    if (clean.some((vote) => vote === null)) continue
    if (clean.filter((vote) => vote!.decision === decision).length !== count) continue
    byId.set(aiShareId(matchId), { id: aiShareId(matchId), matchId, date, firstN: firstN!, firstAt, lastN: lastN!, lastAt, votes: clean as AiShare['votes'], count: count!, decision })
  }
  return [...byId.values()]
}
