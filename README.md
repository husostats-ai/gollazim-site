# GOLLAZIM

Günlük FootyStats CSV dosyasından futbol maç önerileri çıkaran, tamamen tarayıcıda çalışan analiz uygulaması.

**Akış:** CSV yükle → otomatik analiz → kategori bazlı sıralama (en fazla 15 öneri) → story görseli → skor girişi → otomatik kazandı/kaybetti → istatistik.

> **Önemli:** Uygulamada giriş/şifre yoktur. Yayınlanan adresi bilen herkes uygulamayı açıp tüm sayfaları (CSV yükleme, skor girişi, ayarlar dahil) kullanabilir. Ancak veriler her ziyaretçinin kendi tarayıcısında saklandığı için bir ziyaretçi başkasının maçlarını, skorlarını veya istatistiklerini göremez ve değiştiremez; boş bir uygulama açar. Analizleri başkalarıyla paylaşmak ya da erişimi kısıtlamak istenirse sunucu tarafında kimlik doğrulaması ve ortak veritabanı gerekir.

## Çalışma klasörü

Bu projenin tek etkin çalışma klasörü **`/home/ch/gollazim-site`**, tek etkin reposu **`husostats-ai/gollazim-site`**'tir. Claude Code her zaman bu klasörde açılır:

```bash
cd /home/ch/gollazim-site && claude
```

Eski `/home/ch/gollazim` klasörü ve private `husostats-ai/gollazim` reposu yalnızca arşivdir; orada değişiklik yapılmaz, oradan yayın yapılmaz.

## Kurulum ve komutlar

Gereken: Node.js 20 veya üzeri.

```bash
npm install        # bağımlılıkları kur
npm run dev        # yerelde çalıştır: http://localhost:5173
npm test           # birim testleri
npm run typecheck  # tip denetimi
npm run build      # derle (dist/ klasörüne)
npm run preview    # derlenmiş sürümü yerelde aç: http://localhost:4173/gollazim-site/
```

## Günlük kullanım

1. **Admin → CSV YÜKLE:** Günün FootyStats CSV dosyasını seçin. Maçlar okunur, Türkiye saatine göre günlere ayrılır ve kategorilere yerleşir. Aynı maç tekrar yüklenirse kopya oluşmaz, kayıt güncellenir.
2. **Ana sayfa / kategori sayfaları:** Eşiği geçen en güçlü maçlar, yüzdeye göre sıralı. "Temkinli sıra" anahtarı, küçük örneklemden gelen yüksek yüzdeleri geriye iter (ham yüzde değişmez).
3. **Görsel oluştur:** Her kategori listesinin üstünde ve Admin sayfasında; 1080 × 1920 Instagram Story PNG'si üretir.
4. **Skor Girişi:** Maç bitince ilk yarı ve maç skorunu (isteğe bağlı korner ve kart) girip "Tamamlandı" olarak kaydedin. Öneriler o anki yüzde ve eşikle dondurulur, kazandı/kaybetti otomatik hesaplanır.
5. **İstatistik:** Dondurulmuş öneriler üzerinden genel, kategori, güvenilirlik, günlük, haftalık ve aylık başarı.
6. **AI Analizi (isteğe bağlı):** Günün eşiği geçen maçları için ChatGPT ya da Gemini'ye yapıştırılacak hazır prompt üretir. Site hiçbir veriyi kendiliğinden göndermez ve API anahtarı kullanmaz: prompt'u kopyalayıp kendi uygulamanıza yapıştırır, cevabı (`#numara | KARAR | gerekçe | risk`) sayfaya geri yapıştırırsınız. Cevap maçlara yalnızca numarayla bağlanır; okunamayan satırlar elle düzeltilebilir. İki yapay zekânın kararı ayrı saklanır, maç kartında görünür ve İstatistik sayfasında başarıları ölçülür.
7. **Admin → VERİ YEDEĞİ:** Düzenli olarak "Veriyi dışa aktar (JSON)" ile yedek alın.

## Veri nerede saklanır

- **Veri her cihazda ve her tarayıcıda ayrıdır.** Maçlar, skorlar, öneriler ve eşikler yalnızca kullandığınız tarayıcının yerel deposunda (IndexedDB) durur; hiçbir sunucuya gönderilmez. Başka bir bilgisayarda, başka bir tarayıcıda veya gizli pencerede uygulama boş açılır.
- **Veri JSON ile taşınır.** Admin sayfasında "Veriyi dışa aktar (JSON)" ile indirdiğiniz dosyayı diğer cihazda "Veriyi içe aktar (JSON)" ile yükleyin. İçe aktarma, o tarayıcıdaki mevcut verinin tamamını yedektekiyle değiştirir; iki cihazın verisi birleştirilmez.
- **Yapay zekâ kararları da yedeğe girer.** JSON yedeği maçları, skorları, önerileri, eşikleri ve yapay zekâ kararlarını içerir; bu özellikten önce alınmış yedekler de içe aktarılabilir.
- **Tarayıcı verisi silinirse veri kaybolur** ("site verilerini temizle", tarayıcıyı kaldırma vb.). Tek güvence JSON yedeğidir.
- **CSV ve yedek dosyaları repoya girmez.** `samples/`, `*.csv` ve `gollazim-yedek-*.json` `.gitignore`'dadır. Günlük CSV'ler uygulamadan yüklenir.
- **Bu repo herkese açıktır (public).** Repoya eklenen her dosya ve her commit herkes tarafından görülebilir ve sonradan silinse de geçmişte kalır. CSV, yedek veya gizli bilgi içeren hiçbir dosya commit edilmemelidir.
- **`public/` altına veri dosyası koymayın.** Bu klasördeki her dosya derlenen siteye aynen kopyalanır ve site yayınlanırsa herkese açık olur.

## Analiz nasıl hesaplanır

| Kategori | Kaynak |
|---|---|
| 2.5 Üst, 3.5 Üst, 4.5 Üst | CSV'deki `Over25/35/45 Average` yüzdesi |
| İlk Yarı 0.5 / 1.5 Üst | `Over05/15 FHG HT Average` |
| 2. Yarı 0.5 Üst | `Over05 2HG Average` |
| KG Var | `BTTS Average` |
| 2.5 Üst & KG Var | Maç öncesi xG değerlerinden Poisson ile ortak olasılık |
| Korner 8.5 / 9.5 / 10.5 Üst | `Average Over 8.5/9.5/10.5 Corners` |
| Kart 3.5 / 4.5 Üst | `Average Cards` ortalamasından Poisson |
| Taraf & Gol (Ev / Deplasman kazanır & 1.5 / 2.5 Üst) | 1X2 ve 2.5 Alt/Üst oranlarına kalibre edilmiş Poisson skor modeli; ikinci hesap xG'den |

- Yüzdeler yalnızca CSV'deki değerlerden gelir; veri yoksa (`N/A`, `-1`, sıfır ortalama) maç o kategoride gösterilmez ve nedeni yazılır. Oranlar (`Odds_*`) yalnızca Taraf & Gol grubunda kullanılır.
- **Gol modeli (ikinci hesap):** 2.5 / 3.5 / 4.5 Üst ve KG Var kartlarında hazır yüzdenin altında bir "Model %…" satırı görünür. Beklenen toplam gol, maç öncesi xG toplamıdır (yoksa gol ortalaması); üst çizgileri Poisson ile, KG Var iki takımın xG'sinden bağımsız Poisson ile hesaplanır. Eşik, sıralama ve yıldız hazır yüzdeye göre kalır. Fark 25 puanı aşarsa "Model çelişkisi" rozeti çıkar ve örneklem orta/yüksekse yıldız en fazla 3 olur.
- **Taraf & Gol:** Oranlardan bahisçi marjı çıkarılır; toplam gol beklentisi 2.5 Üst olasılığına, takımlara dağılımı 1X2 olasılıklarına kalibre edilir ve ortak olasılık skor tablosundan toplanır (marjinal yüzdeler çarpılmaz). 2.5 Alt/Üst oranı yoksa toplam gol xG ve gol ortalamasından tahmin edilir ("Piyasa (kısmi)"); 1X2 de yoksa yalnızca xG kullanılır. Ana yüzde ile xG yüzdesi arasında 15 puandan fazla fark "çelişki"dir; xG örneklemi orta/yüksekse yıldız 2 ile sınırlanır. Model 1X2'yi piyasadan 3 puandan fazla saptırıyorsa yıldız 3 ile sınırlanır.
- Her kategoride yalnızca eşiği geçen maçlar, en fazla 15 tane gösterilir. Eşikler Admin sayfasından değiştirilir.
- **Veri güvenilirliği:** CSV'de "kaç maç üzerinden" bilgisi olmadığı için örneklem, yüzdelerin alabildiği değerlerden tahmin edilir (alt sınırdır). 8 maçtan az düşük, 8–15 orta, 16+ yüksek. Düşük güvenilirlikte en fazla 3, ortada en fazla 4 yıldız verilir. Korner ve kart verisinin örneklemi ölçülemez.
- **Temkinli yüzde:** Wilson güven aralığının alt sınırı (%95, tek taraflı); yalnızca sıralama için kullanılır.
- **Başarı oranı:** kazanan / (kazanan + kaybeden). "Değerlendirilemedi" (gerekli veri girilmedi) ve "bekliyor" (maç tamamlanmadı) orana girmez. 20'den az sonuçlanmış öneride "az veri" uyarısı çıkar.

## Klasör yapısı

```
src/
  config/        kategori kayıt defteri, CSV kolon eşlemeleri, tema
  services/
    csv/         CSV okuma, kolon eşleme, tarih, yükleme
    analysis/    hesaplayıcılar, güvenilirlik, yıldız, sıralama motoru
    results/     skor doğrulama, kazandı/kaybetti, öneri dondurma
    stats/       istatistik motoru
    image/       story görseli
    ai/          yapay zekâ prompt'u, cevap çözücü, karar istatistikleri
    data/        veri katmanı arayüzleri + IndexedDB (Dexie) uygulaması
  state/         uygulama durumu
  components/    arayüz parçaları
  pages/         sayfalar
public/          logo, simge, robots.txt (veri dosyası konmaz)
.github/workflows/deploy.yml   GitHub Pages yayını (elle başlatılır)
```

Genişletme noktaları:

- **Yeni kategori:** `src/config/categories.ts`'e bir kayıt, `src/services/analysis/calculators/` altına bir hesaplayıcı, `src/services/results/evaluator.ts`'e kazanma kuralı. Menü, eşik ayarı, görsel ve istatistik kendiliğinden gelir.
- **Yeni CSV kolonu veya farklı kolon adı:** `src/config/columnAliases.ts`.
- **Sunucuya (ör. Supabase) geçiş:** `src/services/data/types.ts`'teki arayüzleri uygulayan yeni dosyalar yazıp `src/services/data/index.ts`'teki import'ları değiştirmek yeterlidir.

## Ortam değişkenleri

Şu an **hiçbir ortam değişkeni gerekmez**; repoda anahtar veya gizli bilgi yoktur. İleride bir veritabanı eklenirse kullanılacak adlar `.env.example` dosyasında belgelenmiştir. `.env` dosyaları `.gitignore`'dadır. `VITE_` ile başlayan değişkenler derlenen sitede herkesçe okunabilir; gizli anahtar oraya konmaz.

## Yayın (GitHub Pages)

Site adresi: **https://husostats-ai.github.io/gollazim-site/**

- Yayın iş akışı `.github/workflows/deploy.yml` dosyasındadır ve **kendiliğinden çalışmaz**. Yeni bir sürümü yayınlamak için değişiklikleri `main` dalına gönderdikten sonra GitHub'da *Actions → "GitHub Pages'e yayınla" → Run workflow* ile ya da `gh workflow run deploy.yml` komutuyla elle başlatın. İş akışı önce testleri çalıştırır; test geçmezse yayınlamaz.
- Derlemede base yolu repo adıdır (`vite.config.ts` içindeki `REPO_NAME`). Repo adı değişirse orası da değişmelidir.
- Site arama motorlarında listelenmesin diye `index.html`'de `noindex` etiketi ve `public/robots.txt` (`Disallow: /`) vardır. Not: arama motorları `robots.txt`'yi yalnızca alan adının kökünde arar; bu site bir alt dizinde yayınlandığı için asıl etkili olan `noindex` etiketidir. Bunlar gizlilik sağlamaz, yalnızca listelenmeyi önler.
- **Yayındaki sitede veri, yereldekinden ayrıdır.** `localhost` ile `github.io` tarayıcı açısından farklı sitelerdir. Yereldeki verinizi yayındaki siteye taşımak için Admin sayfasından JSON olarak dışa aktarıp yayındaki sitede içe aktarın.

### Yayın öncesi kontrol listesi

Her yayından önce:

- [ ] `git status` temiz; commit edilenler arasında CSV, JSON yedek, `.env` yok (`git ls-files | grep -iE "\.csv$|yedek|^\.env$"` boş dönmeli).
- [ ] `public/` altında yalnızca logo, simge ve `robots.txt` var.
- [ ] Gizli bilgi yok: kodda anahtar, şifre, token bulunmuyor.
- [ ] `npm test` ve `npm run build` hatasız.
- [ ] FootyStats kullanım koşulları, veriden üretilen analizlerin bu şekilde kullanılmasına izin veriyor.

## Geçmiş ve arşiv

Bu repo, geliştirmenin yapıldığı özel (private) arşiv reposunun `3665878` commit'indeki dosyalardan, git geçmişi olmadan başlatılmıştır. Arşiv reposunun geçmişinde örnek bir CSV bulunduğu için o repo herkese açılmaz; yeni geliştirme yalnızca bu repoda yapılır.

## Yazı tipi

Arayüzde ve story görsellerinde [Inter](https://rsms.me/inter/) kullanılır. Yazı tipi projeye gömülüdür (`@fontsource-variable/inter`, internetten indirilmez) ve SIL Open Font License 1.1 ile lisanslıdır; lisans metni `node_modules/@fontsource-variable/inter/LICENSE` dosyasındadır.

## Tarayıcı desteği

Chrome 107 ve üzerinde denenmiştir.

## Üye sayfası (geliştirme aşamasında)

`#/uye` adresinde, kullanıcı adı ve şifreyle açılan salt okunur bir sayfa. Sunucu yoktur: yayınlanan veri, izinli alan listesiyle sıfırdan kurulan bir **yayın paketi** olarak şifrelenir; üye tarayıcısında kullanıcı adı ve şifresiyle çözer. Ana menüde bağlantısı yoktur.

- **Pakete giren alanlar** `src/services/member/payload.ts` içinde tek tek yazılıdır; ham CSV, oranlar, xG, ortalamalar, yapay zekâ kararları ve ayarlar girmez. `schema.ts` izinli olmayan tek bir alanı reddeder; sızıntı testleri (`leak.test.ts`, `src/member/view.test.ts`) paketi ve çizilen sayfayı yasak terimler için tarar.
- **Şifreleme** `src/services/member/crypto.ts`: AES-256-GCM, PBKDF2-SHA256 (en az 600.000 iterasyon). Şifreler yalnızca üretilir (kullanıcı seçemez); şifre hiçbir yerde saklanmaz, sekmenin `sessionStorage`'ında yalnızca türetilmiş anahtar tutulur ve 12 saat işlem yapılmazsa oturum kapanır.
- **Sınır:** üye sayfası (`src/member/`) veri deposunu, analiz motorunu ve uygulama durumunu içe aktaramaz (`boundary.test.ts`); ayrı bir parça olarak derlenir.
- **Paket adresi:** `VITE_UYE_PAKET_URL` (bkz. `.env.example`).
- **Yasal uyarı penceresi:** giriş ekranı (ayrı üye sitesi ve eski `#/uye` rotası) her açıldığında önce bu pencere çıkar; "18 yaşından büyüğüm, kabul ediyorum" denene kadar giriş formu etkisizdir ve hiçbir ağ isteği gitmez. Metin kodda sabittir (`src/member/legalNotice.ts`, pencere `MemberLegalNotice.tsx`); yayın paketinden ya da Admin ayarlarından gelmez. Onay cihazda saklanmaz: sayfa yenilenince ya da yeni sekmede pencere yeniden çıkar; oturum açıkken çıkmaz.
- **Admin tarafı** (Admin sayfası, "ÜYE SAYFASI" bölümleri; kod `src/services/memberAdmin/` ve `src/components/member/`):
  - *Üyeler:* kullanıcı adını siz verirsiniz, şifreyi uygulama üretir ve **bir kez** gösterir. Şifre hiçbir yere kaydedilmez; yalnızca türetilmiş anahtarlar saklanır. Çıkarma ve şifre yenileme **bir sonraki yayında** etkili olur.
  - *Yayınla:* seçilen gün + önceki gün için paketi kurar, o günlerin ham verisine karşı sızıntı denetiminden geçirir, aktif üyeler için şifreler ve `paket.json` olarak indirir. Denetim tek bir bulgu verirse dosya indirilmez.
  - *Üye anahtar yedeği:* üye listesi ve anahtarlar normal veri yedeğine **girmez** ve normal yedeği geri yüklemek onları silmez. Kendi parolanızla şifrelenmiş ayrı bir dosyadır (`gollazim-uye-anahtar-….json`). Bu yedek ve tarayıcı verisi birlikte kaybolursa tüm şifreler yeniden dağıtılır.
  - Şifre içeren dağıtım listesi (`gollazim-uye-dagitim-….csv`), anahtar yedeği ve `paket.json` `.gitignore`'dadır; repoya ya da `public/` altına konmaz.

### Yayınlama

Admin sayfasında **Yayınla** ile indirilen `paket.json`, ayrı bir public repo olan [`gollazim-yayin`](https://github.com/husostats-ai/gollazim-yayin) üzerinden sunulur (`https://husostats-ai.github.io/gollazim-yayin/paket.json`; üye sayfasının varsayılan adresi budur). Site reposuna paket konmaz.

```
npm run yayinla -- ~/İndirilenler/paket.json     # paketi yayınlar
npm run yayinla -- --kaldir                      # yayındaki paketi kaldırır (üye sayfası "yayın yok" der)
```

- Komut önce dosyanın **şifreli** bir yayın paketi olduğunu denetler; düz paket, veri yedeği ya da anahtar yedeği verilirse hiçbir şey göndermeden durur.
- Yayın reposu her seferinde geçmişsiz **tek commit** olarak yeniden kurulur (yalnızca `paket.json` ve `.nojekyll`) ve force-push edilir; ardından dosya yayın adresinden çekilip SHA-256 özeti karşılaştırılır. Pages yeni dosyayı genelde bir dakikanın altında sunar.
- Yalnızca mevcut `gh` oturumu kullanılır; hiçbir anahtar dosyaya ya da repoya yazılmaz.
- Eski commit'ler repoda görünmez, ama GitHub onları bir süre SHA ile sunmaya devam edebilir ve paketi indiren herkes kopyasını saklayabilir: "geçmiş tutmaz" bir kolaylıktır, silme garantisi değildir. İçerik şifrelidir.
- Üye çıkarma ve şifre yenileme, yeni paket **yayınlandığında** etkili olur.

### Ayrı üye sitesi

Üye uygulaması ayrıca kendi adresinde yayınlanır: **https://husostats-ai.github.io/gollazim-uye/**. O adreste yalnızca üye uygulaması vardır; admin sayfaları, veri deposu ve CSV okuyucu derlemeye girmez. Uygulama kökte çalışır (`#/` analizler, `#/istatistik`); eski `#/uye` bağlantıları ve bilinmeyen adresler köke yönlenir. Üyelere verilen adres budur; Admin'deki "Hesap mesajını kopyala" bu adresi yazar. Paket yine `gollazim-yayin` adresinden gelir.

```
npm run build:uye      # yalnızca derler: dist-uye/
npm run uye-yayinla    # denetler, derler, yayınlar ve canlıda doğrular
npm run uye-yayinla -- --dogrula   # canlıdaki dosyalar yereldeki dist-uye ile aynı mı
```

- Giriş `uye.html` → `src/member/main.tsx`, yapılandırma `vite.uye.config.ts`.
- `uye-yayinla` şunları şart koşar: çalışma ağacı temiz, `HEAD` uzak `main` ile aynı, tip denetimi ve tüm testler geçiyor, çıktı `scripts/lib/uye-cikti-denetim.mjs` denetiminden geçiyor (izinli dosya listesi; veri deposu, admin sayfası, paket şifreleme kodu, ham veri ve yasak terim izi yok; `noindex` ve başlık yerinde). Sonra üye sitesinin reposu geçmişsiz tek commit olarak kurulur ve force-push edilir. Yalnızca mevcut `gh` oturumu kullanılır.
- **Üye sitesi admin sitesinden ayrı yayınlanır.** Üye uygulamasını ya da paket biçimini değiştiren her sürümden sonra `npm run uye-yayinla` çalıştırılmalıdır; `deploy.yml` yalnızca admin sitesini yayınlar. Üye sitesi `surum.json` ile sürümünü bildirir; Admin'in "Yayınla" bölümü üye sitesi eski kaldıysa uyarır.
- Üye sitesi admin sitesiyle aynı alan adındadır (`husostats-ai.github.io`): tarayıcı depolaması yalıtılmış değildir. Üye uygulaması veritabanı ve `localStorage` kullanmaz; bu, çıktı denetimiyle ve uçtan uca denemeyle doğrulanır.

### Yerelde deneme

Çıktılar `samples/uye/` altına yazılır, repoya girmez:

```
UYE_ORNEK=samples/uye UYE_BACKUP=samples/gollazim-yedek-YYYY-AA-GG.json npm run uye:ornek   # şifreli örnek paket + sentetik test kullanıcısı (giris.json)
npm run dev                                                                                # http://localhost:5173/#/uye
```

`giris.json` test kullanıcısının şifresini düz metin olarak içerir; işiniz bitince silin.

Uçtan uca denemeler (derlenmiş site, gerçek tarayıcı, geçici profil). Bunlar kendi sentetik kullanıcılarını ve paketlerini **geçici bir klasörde** üretir ve bitince siler; kalıcı bir giriş dosyası bırakmaz:

```
npm run build && npm run build:uye && UYE_BACKUP=samples/….json npm run uye:e2e             # üye uygulaması: eski #/uye rotası ve ayrı üye sitesi, aynı paketlerle
npm run build && UYE_BACKUP=samples/….json UYE_CSV=samples/….csv npm run uye:admin-e2e      # Admin: üye yönetimi, yayın, anahtar yedeği + tüm sayfalar için duman testi
```

Veritabanı şeması değiştiğinde `scripts/dexie-yukseltme-testi.mjs` eski sürümün derlemesiyle kurulan veritabanını yeni sürümle açıp tabloları karşılaştırır. `scripts/uye-canli-e2e.mjs` canlı yayın adresini yereldeki üye sayfasıyla dener; **yayın adresine deneme paketi gönderir ve sonunda paketi kaldırır**, gerçek üyeler yayındayken çalıştırılmaz. Tarayıcı sürücüsünün kurulumu aşağıdaki bölümdedir.

## Referans dökümü (geliştirme aracı)

Bir değişikliğin analizi, dondurulmuş önerileri, istatistikleri ve story görsellerini etkilemediğini göstermek için değişiklikten önce ve sonra çalıştırılır; özet dosyaları (`ozetler.sha256`, `png.sha256`) birebir aynı çıkmalıdır. Çıktılar veri içerir ve `samples/ref/` altına yazılır (repoya girmez).

```
REF_BACKUP=samples/gollazim-yedek-YYYY-AA-GG.json npm run referans       # metin çıktıları
npm run referans:png                                                    # 12 story PNG (gerçek tarayıcı)
```

- `REF_OUT` çıktı klasörünü değiştirir (varsayılan `samples/ref`); karşılaştırma için ikinci çalıştırmada başka bir klasör verin.
- PNG'ler tarayıcıda üretilir. `puppeteer-core` projenin bağımlılığı **değildir**; repo dışına bir kez kurulur: `mkdir -p ~/araclar/puppeteer-chrome107 && cd ~/araclar/puppeteer-chrome107 && npm init -y && npm i puppeteer-core@19.2.2` (Chrome 107 ile çalışan sürüm). Başka bir klasör `PUPPETEER_DIR`, başka bir tarayıcı `CHROME_PATH` ile gösterilir. Tarayıcı her çalıştırmada yeni, geçici bir profille açılır.
