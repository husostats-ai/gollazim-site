import { ageGroup, normalizeTeam } from '../league/matching'

// Takım adlarının küçük yazım farklarını eşleştirir (Al Akhdoud / Al Okhdoud, Al Tai / Al Taee,
// Al Shahania / Al Shahaniya). Bilerek basittir: tam eşleşme, tek harf farkı ya da iki harf farkıyla
// birlikte sesli harfler atılınca aynı iskelet. Emin olunmayan adlar eşleştirilmez.

const ARTICLES = new Set(['al', 'el'])

const compact = (name: string): string => normalizeTeam(name).replace(/ /g, '')

/** Sessiz harf iskeleti: tanımlık ("al") ve sesli harfler atılır, yinelenen harf teke iner */
const skeleton = (name: string): string =>
  normalizeTeam(name)
    .split(' ')
    .filter((token) => !ARTICLES.has(token))
    .join('')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1')

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]
}

/**
 * İki adın benzerlik derecesi: 0 aynı (ekler ve aksanlar dışında), 1 tek harf farkı,
 * 2 iki harf farkı ve sesli harfler atılınca aynı; eşleşmiyorsa null. Yaş grubu eki (U21 vb.) farklıysa eşleşmez.
 */
export function teamDistance(a: string, b: string): number | null {
  const [ca, cb] = [compact(a), compact(b)]
  if (ca === '' || cb === '' || ageGroup(a) !== ageGroup(b)) return null
  if (ca === cb) return 0
  const distance = editDistance(ca, cb)
  if (Math.min(ca.length, cb.length) >= 4 && distance === 1) return 1
  // İskelet tek başına yetmez ("Al Ahli" / "Al Hilal" aynı iskelete düşer): adlar da yakın olmalı.
  const [sa, sb] = [skeleton(a), skeleton(b)]
  if (distance === 2 && sa !== '' && sa === sb) return 2
  return null
}

export const sameTeam = (a: string, b: string): boolean => teamDistance(a, b) !== null

/**
 * Rakip adı karşılaştırması için daha gevşek ölçü: adlardan biri ötekinin başıysa da aynı sayılır
 * ("Lusail" / "Lusail City"). Yalnızca aynı takımın aynı tarihli satırında, gereksiz "rakip adı
 * farklı" uyarısını önlemek için kullanılır; takım eşleştirmede kullanılmaz.
 */
export function sameOpponent(a: string, b: string): boolean {
  if (sameTeam(a, b)) return true
  const [ta, tb] = [normalizeTeam(a).split(' '), normalizeTeam(b).split(' ')]
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return short[0] !== '' && short.every((token, i) => token === long[i])
}
