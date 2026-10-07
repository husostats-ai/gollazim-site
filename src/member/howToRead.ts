// "Nasıl okunur?" kutusunun sabit metni. Paketten gelmez; üye sayfasının kodunda durur.
// Anlatılanlar uygulamanın hesaplarıyla örtüşür ama eşik ya da sınır sayısı vermez.

export interface HowToReadItem {
  title: string
  paragraphs: string[]
}

export const HOW_TO_READ_TITLE = 'Nasıl okunur?'

export const HOW_TO_READ: HowToReadItem[] = [
  {
    title: 'Büyük yüzde',
    paragraphs: [
      'İki türlü olabilir; yüzdenin hemen altındaki etiket hangisi olduğunu söyler.',
      '“Geçmiş maçlarda görülme sıklığı”: iki takımın önceki maçlarının yüzde kaçında bu sonucun görüldüğüdür (ev sahibinin iç saha, deplasman takımının dış saha maçları). %100, sayılan maçların hepsinde görüldü demektir; bu maçta da olacağı anlamına gelmez.',
      '“Model tahmini”: geçmişteki sıklık değil, bir hesap modelinin verdiği olasılıktır. 2.5 Üst & KG Var, Kart ve Taraf & Gol listelerindeki yüzdeler böyledir.',
      'Bazı kartlarda büyük yüzdenin altında “Model” ya da “İkinci hesap” adıyla ikinci bir yüzde görünür: aynı sonucun başka bir yöntemle yapılmış hesabıdır.',
    ],
  },
  {
    title: 'Yıldız',
    paragraphs: [
      'Yıldız (1–5) yüzdenin büyüklüğünü özetler: yüzde yükseldikçe yıldız artar.',
      'Ancak yüzde az maça dayanıyorsa ya da kaç maça dayandığı ölçülemiyorsa en yüksek yıldızlar verilmez. İki hesap birbiriyle çelişiyorsa da yıldız sınırlanabilir. Bu yüzden çok yüksek bir yüzde tam yıldız almayabilir.',
    ],
  },
  {
    title: 'Güvenilirlik',
    paragraphs: [
      'Yüzdenin kaç maçlık veriye dayandığını gösterir. Düşük: az maç var; örnek az olduğu için yüzde tesadüfen çok yüksek ya da çok düşük çıkmış olabilir. Orta ve Yüksek: yüzde daha çok maça dayanıyor.',
      '“Ölçülemedi” (korner ve kart listeleri) ve “Bilinmiyor”: yüzdenin kaç maça dayandığı çıkarılamadı.',
      '“Model tabanlı” (Taraf & Gol listeleri): yüzde geçmiş maç sayısına değil, modelin hesabına dayanır. “(kısmi)” ise hesabın bir bölümünün tahmine dayandığını belirtir.',
      'Yüzde %100 ve güvenilirlik Düşük ise yüzde soluk gösterilir: az maçta hep görülmüş olması güçlü bir işaret değildir.',
    ],
  },
  {
    title: 'Çelişki rozetleri',
    paragraphs: [
      '“Model çelişkisi”: geçmişteki sıklık ile modelin hesabı arasında büyük fark var.',
      '“Hesaplar çelişiyor” (Taraf & Gol): aynı sonuç için yapılan iki ayrı hesap birbirinden belirgin biçimde ayrılıyor.',
      'İkisi de “temkinli oku” demektir; hangi hesabın doğru olduğunu söylemez.',
    ],
  },
  {
    title: 'Lig sırası ve oynanan maç',
    paragraphs: [
      'Kartın altındaki “Ev” ve “Dep” satırları takımın lig tablosundaki sırasını ve oynadığı maç sayısını gösterir. Tablo elle güncellenir; “⚠ tablo eski” yazıyorsa bilgi güncel olmayabilir. Tablosu girilmemiş liglerde bu satır görünmez.',
    ],
  },
  {
    title: 'Aynı maçın diğer önerileri',
    paragraphs: [
      'Aynı maç başka listelerde de yer alıyorsa kartın altında küçük harflerle gösterilir. Yanında “(model)” yazanlar model tahminidir; diğerleri geçmiş maçlardaki görülme sıklığıdır.',
    ],
  },
  {
    title: 'Hiçbiri garanti değildir',
    paragraphs: ['Buradaki hiçbir yüzde, yıldız ya da rozet sonucun garantisi değildir. Bu bir istatistik taramasıdır; bahis tavsiyesi değildir. 18+'],
  },
]
