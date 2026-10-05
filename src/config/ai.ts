// Yapay zekâ analizi ayarları. Site hiçbir yapay zekâ servisine bağlanmaz:
// prompt üretir, kullanıcı onu kendi uygulamasına yapıştırır ve cevabı geri getirir.

export type AiProvider = 'chatgpt' | 'gemini'
export type AiDecision = 'strong' | 'medium' | 'weak' | 'reject'

export const AI_PROVIDERS: { id: AiProvider; label: string; instruction: string }[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    instruction:
      'ChatGPT için yönerge: Cevap vermeden önce web arama (Search) özelliğini aç. Her maç için güncel sakatlık, cezalı oyuncu, muhtemel kadro, rotasyon ve motivasyon (puan durumu, maçın önemi) bilgisini araştır. Bulduğun bilgiyi gerekçede kullan ve kaynağın adını gerekçenin sonuna parantez içinde yaz. Arama yapamıyorsan ya da bilgi bulamadıysan bunu "bilinmiyor" diye belirt.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    instruction:
      'Gemini için yönerge: Cevap vermeden önce Google Arama ile araştırma özelliğini kullan. Her maç için güncel sakatlık, cezalı oyuncu, muhtemel kadro, rotasyon ve motivasyon (puan durumu, maçın önemi) bilgisini araştır. Bulduğun bilgiyi gerekçede kullan ve kaynağın adını gerekçenin sonuna parantez içinde yaz. Arama yapamıyorsan ya da bilgi bulamadıysan bunu "bilinmiyor" diye belirt.',
  },
]

/** approved: yapay zekâ maçı oynanabilir buldu (istatistikte "onay" sayılır) */
export const AI_DECISIONS: { id: AiDecision; label: string; approved: boolean }[] = [
  { id: 'strong', label: 'Güçlü', approved: true },
  { id: 'medium', label: 'Orta', approved: true },
  { id: 'weak', label: 'Zayıf', approved: false },
  { id: 'reject', label: 'Eleme', approved: false },
]

export const providerLabel = (id: AiProvider): string => AI_PROVIDERS.find((p) => p.id === id)!.label
export const decisionLabel = (id: AiDecision): string => AI_DECISIONS.find((d) => d.id === id)!.label
export const isApproved = (id: AiDecision): boolean => AI_DECISIONS.find((d) => d.id === id)!.approved

/** Bir prompt parçasındaki en fazla maç sayısı */
export const AI_CHUNK_SIZE = 20
