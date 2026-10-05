// FootyStats dışa aktarımının biçimini taklit eden test verisi. Kolon adları
// gerçek dosyadakiyle aynıdır; takımlar ve sayılar uydurmadır (gerçek CSV'ler
// repoya eklenmez). Ondalık virgül, N/A ve -1 gibi biçim özelliklerini içerir.

const HEADER = [
  'date_unix',
  'date_GMT',
  'Country',
  'League',
  'Home Team',
  'Away Team',
  'Home Team Points Per Game (Pre-Match)',
  'Away Team Points Per Game (Pre-Match)',
  'Average Goals',
  'BTTS Average',
  'Over05 Average',
  'Over15 Average',
  'Over25 Average',
  'Over35 Average',
  'Over45 Average',
  'Over05 FHG HT Average',
  'Over15 FHG HT Average',
  'Over05 2HG Average',
  'Over15 2HG Average',
  'Average Corners',
  'Average Cards',
  'Average Over 8.5 Corners',
  'Average Over 9.5 Corners',
  'Average Over 10.5 Corners',
  'Match Status',
  'Home Team Corners',
  'Odds_Over25',
  'Home Team Pre-Match xG',
  'Away Team Pre-Match xG',
]

// Satır 1: ev 3 + deplasman 3 maçlık örneklem (yüzdeler 1/6 adımlı), 5 Ekim 2026 12:00 TR
// Satır 2: ev 9 + deplasman 9 maçlık örneklem (yüzdeler 1/18 adımlı), oranlar N/A, kart ortalaması 0
// Satır 3: 4 Ekim 21:30 GMT = 5 Ekim 00:30 TR (gün değişir)
const ROWS = [
  ['1791190800', 'Oct 05 2026 - 9:00am', 'Testland', 'Deneme Ligi', 'Kuzey Yıldızı', 'Güney Spor', '"1,33"', '"0,33"', '"2,5"', '33', '100', '84', '50', '17', '0', '67', '17', '84', '33', '"8,67"', '"4,34"', '84', '67', '34', 'incomplete', '-1', '"1,89"', '"1,35"', '"0,88"'],
  ['1791205200', 'Oct 05 2026 - 1:00pm', 'Testland', 'Deneme Ligi U21', 'Doğu Gençlik U21', 'Batı Akademi U21', '"1,11"', '"0,78"', '"3,06"', '39', '100', '89', '61', '28', '11', '78', '22', '94', '50', '9', '0', '56', '44', '33', 'incomplete', '-1', 'N/A', '"1,6"', '"1,1"'],
  ['1791149400', 'Oct 04 2026 - 9:30pm', 'Örnekistan', 'Şampiyonluk Kupası', 'İç Anadolu FK', 'Çağlayan Gücü', '3', '0', '"3,67"', '84', '100', '100', '84', '50', '34', '84', '67', '67', '67', '"11,5"', '"5,5"', '50', '50', '34', 'incomplete', '-1', '"1,5"', '"2,36"', '"1,39"'],
]

export const FOOTYSTATS_SAMPLE = [HEADER.join(','), ...ROWS.map((r) => r.join(','))].join('\n')
