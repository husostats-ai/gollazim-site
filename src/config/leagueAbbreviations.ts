// Story görsellerinde ve açıklama metinlerinde lig adının kısa biçimi. Lig adı
// hiçbir zaman "…" ile kesilmez: önce bu tablo, sonra sözcük kısaltmaları, son
// çare olarak ülke adı + ligin baş harfleri kullanılır.
//
// Yeni bir lig eklemek için LEAGUE_ABBREVIATIONS'a "CSV'deki lig adı: kısa ad"
// satırı eklemek yeterlidir (büyük/küçük harf fark etmez).

/** Bilinen ligler: CSV'deki ad -> görselde yazılacak kısa ad */
export const LEAGUE_ABBREVIATIONS: Record<string, string> = {
  'Professional Development League': 'PDL',
  'EFL Trophy': 'EFL Trophy',
  'EFL Cup': 'EFL Cup',
  'FA Cup': 'FA Cup',
  'UEFA Nations League': 'Nations League',
  'UEFA U21 Championship Qualification': 'UEFA U21 Elemeleri',
  'UEFA Champions League': 'UEFA CL',
  'UEFA Europa League': 'UEFA EL',
  'UEFA Europa Conference League': 'UEFA ECL',
  'ASEAN Cup': 'ASEAN Cup',
  'U19 League': 'U19 Ligi',
}

/** Tabloda olmayan liglerde, anlamı koruyarak kısaltılan sözcükler (sırayla denenir) */
export const WORD_ABBREVIATIONS: [word: string, short: string][] = [
  ['Qualification', 'Qual.'],
  ['Qualifying', 'Qual.'],
  ['Championship', 'Champ.'],
  ['Professional', 'Pro.'],
  ['Development', 'Dev.'],
  ['International', 'Int.'],
  ['Division', 'Div.'],
  ['Conference', 'Conf.'],
  ['Regional', 'Reg.'],
  ['National', 'Nat.'],
  ['Premier', 'Prem.'],
  ['Women', 'W'],
  ['League', 'Lg.'],
]

const SEPARATOR = ' · '
const byLowerName = new Map(Object.entries(LEAGUE_ABBREVIATIONS).map(([name, short]) => [name.toLocaleLowerCase('en'), short]))

/** Maç kaydındaki "Ülke · Lig" metnini ayırır; ülke yoksa country boş olur */
export function splitLeague(league: string): { country: string; name: string } {
  const index = league.indexOf(SEPARATOR)
  return index < 0 ? { country: '', name: league.trim() } : { country: league.slice(0, index).trim(), name: league.slice(index + SEPARATOR.length).trim() }
}

const join = (country: string, name: string) => (country ? `${country}${SEPARATOR}${name}` : name)

/** Ligin baş harfleri: "Second Division North" -> "SDN"; rakamla başlayan parça ("U21", "2.") olduğu gibi kalır */
export const leagueInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^[A-Za-zÇĞİÖŞÜçğıöşü]\D*$/.test(word) ? word[0].toLocaleUpperCase('tr') : word))
    .join('')
    // Baş harflerin arasına giren "U21" gibi parçalar okunur kalsın
    .replace(/([A-ZÇĞİÖŞÜ])(U\d)/g, '$1 $2')

/**
 * Genişlik sınırı olmadan kullanılan kısa ad (açıklama metinleri): tabloda varsa
 * tablodaki, yoksa ligin kendi adı (ülkesiz).
 */
export function leagueShortName(league: string | undefined): string {
  if (!league) return ''
  const { name } = splitLeague(league)
  return byLowerName.get(name.toLocaleLowerCase('en')) ?? name
}

/**
 * Lig adının verilen genişliğe sığan en bilgilendirici biçimi; sırayla denenir:
 * 1. tablodaki kısa ad (ülkeyle, sığmazsa ülkesiz); 2. tam ad; 3. ülkesiz ad;
 * 4. uzun sözcükler birer birer kısaltılmış ad; 5. sondaki sözcükler atılmış ad (en az iki sözcük);
 * 6. ülke + baş harfler; 7. baş harfler.
 * Hiçbir adımda "…" kullanılmaz. En kısa biçim de sığmıyorsa yine o döner.
 */
export function fitLeague(league: string | undefined, maxWidth: number, measure: (text: string) => number): string {
  if (!league) return ''
  const { country, name } = splitLeague(league)
  const candidates: string[] = []
  const known = byLowerName.get(name.toLocaleLowerCase('en'))
  if (known) candidates.push(join(country, known), known)
  else candidates.push(join(country, name), name)

  let shortened = known ?? name
  for (const [word, short] of WORD_ABBREVIATIONS) {
    const next = shortened.replace(new RegExp(`\\b${word}\\b`, 'gi'), short)
    if (next !== shortened) {
      shortened = next
      candidates.push(shortened)
    }
  }
  // Sondaki sözcükler birer birer atılır ("TFF Second Lg. White Group" -> "TFF Second Lg."); en az iki sözcük kalır.
  const words = shortened.split(/\s+/)
  for (let keep = words.length - 1; keep >= 2; keep--) candidates.push(words.slice(0, keep).join(' '))
  const initials = leagueInitials(known ?? name)
  candidates.push(join(country, initials), initials)
  return candidates.find((text) => measure(text) <= maxWidth) ?? initials
}
