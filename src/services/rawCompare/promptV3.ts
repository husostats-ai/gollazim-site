import type { Match } from '../../types'
import type { AiMatchItem } from '../ai/collect'

// "Ham veri" promptu, sürüm 3. Metin samples/ham-veri/prompt-v3.txt dosyasından BİREBİR alınmıştır
// (dosya repoya girmez); elle düzenlenmez. Yalnızca iki yer dinamiktir: "[TARİH]" ve
// "=== MAÇLAR ===" ile "=== MAÇLAR SONU ===" arasındaki maç satırları. Metnin özeti testte denetlenir.

export const PROMPT_V3_DATE_MARK = '[TARİH]'

/** Baştan "=== MAÇLAR ===" satırına kadar (o satır dahil) */
export const PROMPT_V3_HEAD: string = [
  "Sen temkinli bir futbol veri araştırmacısısın. Web aramasını aç ve kullan. Aşağıdaki maçlar [TARİH] (Europe/Istanbul) tarihlidir. Sana başka hiçbir veri verilmiyor; yalnızca kendi bulduğun kaynaklara dayan.",
  "",
  "GÖREV",
  "Her maç için iki takımın bu sezonki ham maç sonuçlarını, lig tablosundaki toplamlarını, aralarındaki son karşılaşmaları ve güncel haberleri bul. Ayrıca maçın skorunu tahmin et. Yüzde, oran, yorum, karar veya \"güçlü/zayıf\" gibi bir değerlendirme YAZMA. Hesapları biz yapacağız; senden sadece doğru ham veri istiyoruz.",
  "",
  "ARAMA KURALI",
  "- Her takımın sonuçlarını bulmak için en az 2 farklı kaynakta ara. Hepsi başarısız olursa \"bilinmiyor\" yaz; aramadan \"bilinmiyor\" yazma.",
  "- Önerilen kaynaklar: ligin resmi sitesi, federasyon, FotMob, Sofascore, Flashscore, Soccerway, Mackolik, worldfootball.net, ulusal haber ajansları ve gazeteler. FootyStats'ı KULLANMA. Bahis, tahmin veya API tanıtım sayfalarını lig tablosu ve skor kaynağı olarak kullanma.",
  "",
  "KAYNAK KURALLARI",
  "- Satırlardaki kaynak alanına SADECE site adını yaz. Link, köşeli parantez, parantez veya dipnot kullanma.",
  "- Her veriyi, o takımın veya o maçın kendi sayfasından al. Başka takımın sayfasını, oyuncu sayfasını veya sitenin ana sayfasını kaynak gösterme.",
  "- Satırlarda adını yazdığın her kaynağın KAYNAKLAR bloğunda en az bir linki olsun. Link bulamıyorsan o kaynağı yazma, kaynak alanına \"-\" yaz ve veriyi \"bilinmiyor\" olarak bırak.",
  "- Sayı veya skor uydurma, tahmin yürütme, yuvarlama yapma.",
  "",
  "VERİ KURALLARI",
  "- SON satırları: Her takım için bu sezonki LİG maçlarının HEPSİNİ (en fazla 8), en yeniden en eskiye doğru yaz. Hiçbir lig maçını atlama. Önceki sezon maçlarını EKLEME.",
  "- Lig dışı resmi maçlar (kupa, Avrupa): ayrı satırlar olarak ekle, yarışma alanına KUPA veya AVRUPA yaz, en fazla 3 tane, en yeniden eskiye. Tarihi doğrula (maçın oynandığı gün, haberin yayın günü değil). Hazırlık maçlarını ekleme.",
  "- SKOR YÖNÜ (çok önemli): SON satırlarında skor her zaman \"takımın kendi golü - rakibin golü\" şeklinde yazılır, iç/dış saha fark etmez. İÇ = takımın kendi sahası, DIŞ = rakibin sahası.",
  "- İY (ilk yarı) skoru da aynı yönde yazılır. İlk yarı skoru bilinmiyorsa veya kaynaklar çelişiyorsa ? yaz. Tahmin etme.",
  "- SON satırlarında 10 alan da dolu olmalı. Bir alanı bilmiyorsan o alana \"bilinmiyor\" yaz, ama alanı silme.",
  "- TOPLAM satırı: ligin resmi tablosundaki değerleri yaz (oynanan maç, galibiyet-beraberlik-mağlubiyet, atılan-yenilen gol, puan, lig sırası).",
  "- KONTROL 1: Takımın lig maçı sayısı 8 veya daha azsa, yarışma = LİG olan SON satırlarının sayısı \"oynanan\" sayısına eşit olmalı. Eksik satır varsa tekrar ara. Bulamazsan TOPLAM satırının sonuna \"EKSİK N maç\" yaz.",
  "- KONTROL 2: Aynı durumda SON satırlarındaki galibiyet/beraberlik/mağlubiyet, atılan-yenilen gol ve puan toplamı TOPLAM satırıyla tutmalı. Cevaplamadan önce hesapla. Tutmuyorsa skorları yeniden kontrol et ve düzelt. Düzeltemezsen TOPLAM satırının sonuna \"UYUŞMUYOR\" yaz. \"UYUŞMUYOR\" yalnızca sayılar birbirini tutmadığında yazılır; veri bilinmiyorsa \"bilinmiyor\" yaz.",
  "- Takım 8'den fazla lig maçı oynadıysa TOPLAM satırının sonuna \"liste tüm sezonu kapsamıyor\" yaz.",
  "- H2H satırları: iki takımın son resmi karşılaşmaları, en fazla 5, en yeniden en eskiye. En az 2 kaynakta ara ve hiçbirini atlama. Skor, o maçın ev sahibi golü - deplasman golü şeklinde yazılır ve ev sahibi takımın adı yazılır. Güvenilir H2H bulamazsan tek satır: #numara | H2H | bilinmiyor.",
  "- Sakatlık, cezalı, muhtemel kadro, rotasyon ve motivasyon (puan durumu, maçın önemi) bilgisini ara. Sadece bu maçı doğrudan etkileyen bilgiyi yaz. Transfer, kulüp haberi veya geçmiş sezon bilgisi yazma. Bulamazsan \"bilinmiyor\" yaz.",
  "- SKOR tahmini yalnızca bir tahmindir. Gerekçen sayıya dayanmalı ve kimin kazanacağını (veya berabere biteceğini) açıklamalı. Açıklayamıyorsan skor yazma, \"bilinmiyor\" yaz. Gerekçede yazdığın her sayı yukarıdaki SON, TOPLAM veya H2H satırlarıyla tutarlı olmalı.",
  "",
  "CEVAP BİÇİMİ",
  "Her maç için şu satırları yaz, sırası: SON satırları (önce ev sahibi, sonra deplasman takımı), TOPLAM (ev sahibi), TOPLAM (deplasman), H2H satırları, SKOR, HABER.",
  "- SON satırı (10 alan): #numara | SON | takım adı | GG.AA.YYYY | rakip | İÇ veya DIŞ | takımın kendi golü-rakibin golü | İY takımın kendi golü-rakibin golü | LİG, KUPA veya AVRUPA | kaynak adı",
  "- TOPLAM satırı: #numara | TOPLAM | takım adı | oynanan N | G-B-M | atılan-yenilen | N puan | lig sırası N | kaynak adı",
  "- H2H satırı: #numara | H2H | GG.AA.YYYY | ev sahibi takım - deplasman takımı | ev sahibi golü-deplasman golü | İY ev sahibi golü-deplasman golü | yarışma | kaynak adı",
  "- SKOR satırı: #numara | SKOR | ev golü-deplasman golü | tek cümle sayısal gerekçe | kaynak adı. Skor alanına sadece rakamları yaz (örnek: 1-2), takım adı yazma. Gerekçe yoksa: #numara | SKOR | bilinmiyor | yeterli veri yok | -",
  "- HABER satırı: #numara | HABER | sakatlık, cezalı, rotasyon, motivasyon özeti (bilinmiyorsa \"bilinmiyor\") | kaynak adı",
  "- Takım adlarını maç listesindeki gibi yaz. Rakip adlarını kaynaktaki gibi yaz.",
  "- Tüm maç satırlarını bitirdikten sonra ayrı bir blok ekle: önce \"=== KAYNAKLAR ===\" satırı, sonra her kaynak için bir satır: site adı | düz URL (köşeli parantez veya markdown yok) | hangi maç numarası ve hangi takım veya hangi maç tarihi için kullanıldığı.",
  "- Cevabın başına veya sonuna açıklama cümlesi ekleme. İlk karakter \"#\" olsun, son satır KAYNAKLAR bloğunun son satırı olsun.",
  "- Markdown, tablo, kalın yazı, başlık, madde işareti, dipnot kullanma.",
  "- Verilen numaraları aynen kullan. Maçları yeniden numaralama, satır atlama.",
  "",
  "=== MAÇLAR ===",
  "",
].join('\n')

/** "=== MAÇLAR SONU ===" satırından sona kadar */
export const PROMPT_V3_TAIL: string = [
  "=== MAÇLAR SONU ===",
  "",
].join('\n')

/** Bir prompttaki en fazla maç sayısı; fazlası yeni bir prompta geçer */
export const PROMPT_V3_GROUP_SIZE = 8

export interface RawPrompt {
  /** 1'den başlar */
  index: number
  total: number
  /** Bu prompttaki ilk ve son maç numarası */
  from: number
  to: number
  text: string
}

/** "#n | HH:MM | Ülke · Lig | Ev - Dep": AI ANALİZİ promptundaki maç başlığı satırıyla aynı biçim */
export const rawPromptLine = (match: Match, number: number): string => `#${number} | ${match.time ?? 'saat yok'} | ${match.league ?? 'lig yok'} | ${match.home} - ${match.away}`

/**
 * Günün maçlarından yapıştırılmaya hazır promptlar. Maçlar AI ANALİZİ promptundaki seçim ve
 * sırayla verilir (collectAiMatches); numara listedeki sıradır ve gruplar arasında devam eder
 * (ikinci grup #9'dan başlar). Öneri, istatistik ya da model satırı eklenmez. Maç yoksa boş dizi.
 */
export function buildRawPrompts(items: readonly AiMatchItem[], dateLabel: string, groupSize: number = PROMPT_V3_GROUP_SIZE): RawPrompt[] {
  const head = PROMPT_V3_HEAD.replace(PROMPT_V3_DATE_MARK, () => dateLabel)
  const total = Math.ceil(items.length / groupSize)
  return Array.from({ length: total }, (_, group) => {
    const from = group * groupSize + 1
    const slice = items.slice(from - 1, from - 1 + groupSize)
    return { index: group + 1, total, from, to: from + slice.length - 1, text: `${head}${slice.map((item, i) => rawPromptLine(item.match, from + i)).join('\n')}\n${PROMPT_V3_TAIL}` }
  })
}
