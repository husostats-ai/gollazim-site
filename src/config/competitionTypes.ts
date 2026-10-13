// Maçın "lig türü": gençlik, rezerv, milli takım, kupa ya da yetişkin ligi. Yalnızca ölçüm
// içindir ("Analiz için özet"teki "Lig türüne göre başarı" tablosu): türetilir, hiçbir kayda
// yazılmaz; hesapları, dondurmayı, eşikleri ve yıldızları etkilemez.
//
// Kuralların TAMAMI bu dosyadadır. Yeni bir lig ya da takım yanlış türe düşüyorsa aşağıdaki
// listelerden ilgili olana bir satır eklemek yeterlidir.

/** Öncelik sırasıyla: bir maç birden çok kurala uyarsa listede önce gelen tür kazanır */
export const COMPETITION_TYPES = [
  { id: 'youth', label: 'Gençlik / U-takım' },
  { id: 'reserve', label: 'Rezerv / II takım' },
  { id: 'national', label: 'Milli takım' },
  { id: 'cup', label: 'Kupa (kulüp)' },
  { id: 'league', label: 'Lig (yetişkin)' },
] as const

export type CompetitionType = (typeof COMPETITION_TYPES)[number]['id']

/** Lig ya da takım adında yaş grubu: U17 … U23 (tam sözcük; "U-21" de olur) */
export const AGE_GROUP = /\bU-?(?:17|18|19|20|21|23)\b/i

/**
 * Gençlik ligi sözcükleri. Yalnızca LİG adında aranır: takım adında aranmaz, çünkü yetişkin
 * kulüplerin adında da geçer (Shenzhen Juniors, Hamilton Academical).
 */
export const YOUTH_LEAGUE = /\b(?:Youth|Academy|Juniores|Juniors|Primavera|Development League)\b/i

/** Rezerv takım adı: " II" / " III" / " B" ile biter ya da "Jong " ile başlar (harf büyüklüğü önemlidir) */
export const RESERVE_TEAM = /(?:\s(?:II|III|B)$|^Jong\s)/

/** Adı kurala uymayan rezerv takımlar (küçük harfle) */
export const RESERVE_TEAMS: readonly string[] = ['kups akatemia', 'klubi-04']

/** Adı rezerv kuralına uyan ama yetişkin kulüp olan takımlar (küçük harfle) */
export const NOT_RESERVE_TEAMS: readonly string[] = ['willem ii', 'jong colombia', 'jong holland']

/** Ülke alanı bu değerlerden biriyse yarışma ulusal bir lig değildir (kıta / dünya yarışması) */
export const INTERNATIONAL_COUNTRIES: readonly string[] = ['international', 'europe', 'asia', 'africa', 'south america', 'north america', 'oceania', 'world']

/** Ülke alanı buysa ve yarışma bir kulüp yarışması değilse maç milli takım maçıdır */
export const NATIONAL_COUNTRY = 'international'

/** Milli takım yarışmaları (lig adında aranır) */
export const NATIONAL_COMPETITION =
  /\b(?:Nations League|World Cup|WC Qualification|UEFA Euro|Euro Qualification|European Championship|Copa America|Cup of Nations|Asian Cup|Gold Cup|ASEAN Cup|Confederations Cup|International Friendl\w*)\b/i

/** Kulüp yarışması işaretleri: bunlardan biri varsa maç milli takım maçı sayılmaz */
export const CLUB_COMPETITION = /\b(?:Club|Champions League|Europa League|Conference League|Libertadores|Sudamericana)\b/i

/** Kupa sözcükleri (lig adında aranır) */
export const CUP_COMPETITION =
  /\b(?:Cup|Trophy|Pokal|Copa|Coupe|Coppa|Taça|Beker|Shield|Champions League|Europa League|Conference League|Club Championship|Libertadores|Sudamericana|Qualification|Friendl\w*)\b/i
