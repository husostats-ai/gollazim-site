import { decisionLabel, type AiDecision } from '../../config/ai'

// Bir kararlar kümesinin özeti (bir maçın bir kategorideki kararları ya da eski maç geneli kararları).
// Ortalama alınmaz: kararlar tam seviyeleriyle (Güçlü / Orta / Zayıf / Eleme) sayılır ve yalnızca
// cevap veren yapay zekâlar hesaba girer. İki karar varsa iki aynı karar "2/2 aynı" olur ve
// çoğunluk sayılır (Claude eklenmeden önceki günler; bir yapay zekânın kategoriyi atladığı durum).

export type AgreementKind =
  /** Cevap verenlerin hepsi aynı kararı verdi */
  | 'unanimous'
  /** Hepsi değil ama yarıdan fazlası aynı kararı verdi */
  | 'majority'
  /** Hiçbir karar yarıdan fazla oy almadı */
  | 'split'

export interface Agreement {
  kind: AgreementKind
  /** Kararı kayıtlı yapay zekâ sayısı (en az 2) */
  voters: number
  /** En çok verilen kararın oy sayısı */
  votes: number
  /** Çoğunluk kararı; 'split' ise null */
  decision: AiDecision | null
}

/** Çoğunluk satırının dayandığı yapay zekâ sayısı günden güne değişir; kartta ve istatistikte gösterilir */
export const MAJORITY_NOTE = 'Çoğunluk, karar veren yapay zekâlar üzerinden hesaplanır: eski günlerde 2, yeni günlerde çoğunlukla 3 yapay zekâya dayanır.'

/**
 * Bir maçın kararlarının özeti (her yapay zekâdan en fazla bir karar). Tek karar ya da
 * hiç karar varsa özet yoktur (null).
 */
export function summarizeVerdicts(verdicts: readonly { decision: AiDecision }[]): Agreement | null {
  const voters = verdicts.length
  if (voters < 2) return null
  const counts = new Map<AiDecision, number>()
  for (const v of verdicts) counts.set(v.decision, (counts.get(v.decision) ?? 0) + 1)
  const [decision, votes] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (votes === voters) return { kind: 'unanimous', voters, votes, decision }
  // Yarıdan fazla oy alan karar tektir; eşitlikte (ör. 2 farklı karar) çoğunluk yoktur.
  if (votes * 2 > voters) return { kind: 'majority', voters, votes, decision }
  return { kind: 'split', voters, votes, decision: null }
}

/** Maçın çoğunluk kararı; yoksa null */
export const majorityDecision = (verdicts: readonly { decision: AiDecision }[]): AiDecision | null =>
  summarizeVerdicts(verdicts)?.decision ?? null

/** Rozet metni: "3/3 aynı", "2/3 çoğunluk", "3 farklı" (eski günlerde "2/2 aynı", "2 farklı") */
export const agreementLabel = (a: Agreement): string =>
  a.kind === 'unanimous' ? `${a.voters}/${a.voters} aynı` : a.kind === 'majority' ? `${a.votes}/${a.voters} çoğunluk` : `${a.voters} farklı`

/** Rozet metni, varsa çoğunluk kararıyla: "2/3 çoğunluk · Orta" */
export const agreementText = (a: Agreement): string =>
  a.decision ? `${agreementLabel(a)} · ${decisionLabel(a.decision)}` : agreementLabel(a)
