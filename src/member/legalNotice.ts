// Üye giriş ekranında, form kullanılmadan önce gösterilen yasal uyarı penceresinin metni.
// SABİTTİR: yayın paketinden ya da admin ayarlarından gelmez. Onay hiçbir yere kaydedilmez;
// pencere giriş ekranı her açıldığında yeniden gösterilir.

export const LEGAL_NOTICE = {
  title: '⚠️ Yasal Uyarı',
  paragraphs: [
    'GOL LAZIM ANALİZ, geçmiş maç verilerinden istatistik özetleri sunan bir görüntüleme sayfasıdır. Burada yazanlar bahis tavsiyesi değildir ve bahse yönlendirmez.',
    'Hiçbir yüzde, yıldız ya da analiz sonucun garantisi değildir. Geçmişte görülen bir durum gelecekte de görülecek demek değildir. Bahis ciddi maddi zararlara yol açabilir.',
    'Yasa dışı bahis suçtur. Bahis oynamak isteyenler yalnızca yasal ve yetkili platformları kullanmalıdır. Her kullanıcı, yaşadığı ülkenin yasal düzenlemelerine uymakla yükümlüdür.',
    'Bu sayfayı yalnızca 18 yaşından büyükler kullanabilir.',
  ],
  accept: '18 yaşından büyüğüm, kabul ediyorum',
  decline: 'Kabul etmiyorum',
  declined: 'Devam etmek için onay gerekir.',
} as const
