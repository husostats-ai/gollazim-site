// CSV kolon adı -> uygulamanın kullandığı alan adı eşlemesi.
// CSV formatı değişirse veya yeni bir kaynak eklenirse sadece bu listeye
// takma ad eklemek yeterlidir. Karşılaştırma büyük/küçük harf, boşluk ve
// noktalama işaretlerinden bağımsızdır.

export const COLUMN_ALIASES = {
  dateUnix: ['date_unix', 'timestamp', 'unix'],
  dateText: ['date_GMT', 'date', 'tarih', 'match date'],
  time: ['time', 'saat', 'kickoff'],
  country: ['Country', 'Ülke'],
  league: ['League', 'Lig', 'Competition'],
  home: ['Home Team', 'Home', 'Ev Sahibi', 'home_team', 'home_name'],
  away: ['Away Team', 'Away', 'Deplasman', 'away_team', 'away_name'],
  homePpg: ['Home Team Points Per Game (Pre-Match)'],
  awayPpg: ['Away Team Points Per Game (Pre-Match)'],
  avgGoals: ['Average Goals'],
  bttsPct: ['BTTS Average'],
  over05Pct: ['Over05 Average'],
  over15Pct: ['Over15 Average'],
  over25Pct: ['Over25 Average'],
  over35Pct: ['Over35 Average'],
  over45Pct: ['Over45 Average'],
  ht05Pct: ['Over05 FHG HT Average'],
  ht15Pct: ['Over15 FHG HT Average'],
  sh05Pct: ['Over05 2HG Average'],
  sh15Pct: ['Over15 2HG Average'],
  avgCorners: ['Average Corners'],
  avgCards: ['Average Cards'],
  corners85Pct: ['Average Over 8.5 Corners'],
  corners95Pct: ['Average Over 9.5 Corners'],
  corners105Pct: ['Average Over 10.5 Corners'],
  homeXg: ['Home Team Pre-Match xG'],
  awayXg: ['Away Team Pre-Match xG'],
  oddsHome: ['Odds_Home_Win'],
  oddsDraw: ['Odds_Draw'],
  oddsAway: ['Odds_Away_Win'],
  oddsOver25: ['Odds_Over25'],
  oddsUnder25: ['Odds_Under25'],
} as const satisfies Record<string, readonly string[]>

export type FieldKey = keyof typeof COLUMN_ALIASES

/** Kullanıcıya gösterilen alan adları (eksik kolon mesajları için) */
export const FIELD_LABELS: Record<FieldKey, string> = {
  dateUnix: 'Tarih (unix)',
  dateText: 'Tarih',
  time: 'Saat',
  country: 'Ülke',
  league: 'Lig',
  home: 'Ev sahibi',
  away: 'Deplasman',
  homePpg: 'Ev sahibi maç başı puan',
  awayPpg: 'Deplasman maç başı puan',
  avgGoals: 'Gol ortalaması',
  bttsPct: 'KG Var yüzdesi',
  over05Pct: '0.5 Üst yüzdesi',
  over15Pct: '1.5 Üst yüzdesi',
  over25Pct: '2.5 Üst yüzdesi',
  over35Pct: '3.5 Üst yüzdesi',
  over45Pct: '4.5 Üst yüzdesi',
  ht05Pct: 'İlk yarı 0.5 Üst yüzdesi',
  ht15Pct: 'İlk yarı 1.5 Üst yüzdesi',
  sh05Pct: '2. yarı 0.5 Üst yüzdesi',
  sh15Pct: '2. yarı 1.5 Üst yüzdesi',
  avgCorners: 'Korner ortalaması',
  avgCards: 'Kart ortalaması',
  corners85Pct: 'Korner 8.5 Üst yüzdesi',
  corners95Pct: 'Korner 9.5 Üst yüzdesi',
  corners105Pct: 'Korner 10.5 Üst yüzdesi',
  homeXg: 'Ev sahibi maç öncesi xG',
  awayXg: 'Deplasman maç öncesi xG',
  oddsHome: 'Ev sahibi galibiyet oranı',
  oddsDraw: 'Beraberlik oranı',
  oddsAway: 'Deplasman galibiyet oranı',
  oddsOver25: '2.5 Üst oranı',
  oddsUnder25: '2.5 Alt oranı',
}

/** Metin olarak saklanan alanlar; diğer tüm tanınan alanlar sayıdır */
export const TEXT_FIELDS: readonly FieldKey[] = ['dateText', 'time', 'country', 'league', 'home', 'away']
