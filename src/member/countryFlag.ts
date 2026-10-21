import { leagueEmblem, type LeagueEmblem } from '../components/leagueEmblem'
import { FLAG_SVGS } from './flags'

// Kartın lig satırındaki bayrak. Ülke ayrı bir alan değildir: lig metninin " · " öncesinden
// türetilir ("Netherlands · Eredivisie" -> "Netherlands"). Kıta ve uluslararası kayıtlar için
// ülke bayrağı uydurulmaz; bunlar ve tanınmayan adlar nötr küre simgesine düşer. Amblemi olan
// Avrupa kupaları (tam lig adıyla eşleşir, ../components/leagueEmblem) küre yerine turnuva rozetini gösterir.

/** Lig metnindeki ülke / bölge adı -> flag-icons kodu ve Türkçe ad */
const COUNTRIES: Record<string, { code: string; name: string }> = {
  Australia: { code: 'au', name: 'Avustralya' },
  Belgium: { code: 'be', name: 'Belçika' },
  Bulgaria: { code: 'bg', name: 'Bulgaristan' },
  China: { code: 'cn', name: 'Çin' },
  Denmark: { code: 'dk', name: 'Danimarka' },
  England: { code: 'gb-eng', name: 'İngiltere' },
  Estonia: { code: 'ee', name: 'Estonya' },
  Finland: { code: 'fi', name: 'Finlandiya' },
  Georgia: { code: 'ge', name: 'Gürcistan' },
  Germany: { code: 'de', name: 'Almanya' },
  Iceland: { code: 'is', name: 'İzlanda' },
  Italy: { code: 'it', name: 'İtalya' },
  Japan: { code: 'jp', name: 'Japonya' },
  Kuwait: { code: 'kw', name: 'Kuveyt' },
  Netherlands: { code: 'nl', name: 'Hollanda' },
  Norway: { code: 'no', name: 'Norveç' },
  Portugal: { code: 'pt', name: 'Portekiz' },
  Qatar: { code: 'qa', name: 'Katar' },
  'Saudi Arabia': { code: 'sa', name: 'Suudi Arabistan' },
  Scotland: { code: 'gb-sct', name: 'İskoçya' },
  Singapore: { code: 'sg', name: 'Singapur' },
  Spain: { code: 'es', name: 'İspanya' },
  Sweden: { code: 'se', name: 'İsveç' },
  Switzerland: { code: 'ch', name: 'İsviçre' },
  Turkey: { code: 'tr', name: 'Türkiye' },
  Wales: { code: 'gb-wls', name: 'Galler' },
}

/** Bayrağı olmayan, bilerek küreyle gösterilen bölgeler */
const REGIONS: Record<string, string> = {
  Europe: 'Avrupa',
  Asia: 'Asya',
  Africa: 'Afrika',
  International: 'Uluslararası',
  World: 'Dünya',
}

export type LeagueFlag = { kind: 'flag'; code: string; name: string; svg: string } | LeagueEmblem | { kind: 'globe'; name: string }

/** Lig metninin " · " öncesi; ayraç yoksa null */
export function countryOf(league: string): string | null {
  const at = league.indexOf(' · ')
  const country = at === -1 ? '' : league.slice(0, at).trim()
  return country || null
}

/** Lig satırının simgesi; ülke yoksa null (simge çizilmez) */
export function leagueFlag(league: string): LeagueFlag | null {
  const country = countryOf(league)
  if (!country) return null
  const emblem = leagueEmblem(league)
  if (emblem) return emblem
  const known = COUNTRIES[country]
  const svg = known && FLAG_SVGS[known.code]
  if (known && svg) return { kind: 'flag', code: known.code, name: known.name, svg }
  return { kind: 'globe', name: REGIONS[country] ?? country }
}
