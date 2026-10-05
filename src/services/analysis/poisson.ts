/** Ortalaması lambda olan Poisson dağılımında P(X = k) */
export const poissonPmf = (k: number, lambda: number): number => {
  let p = Math.exp(-lambda)
  for (let i = 1; i <= k; i++) p *= lambda / i
  return p
}

/** P(X >= k) */
export const poissonAtLeast = (k: number, lambda: number): number => {
  let below = 0
  for (let i = 0; i < k; i++) below += poissonPmf(i, lambda)
  return Math.max(0, 1 - below)
}

/**
 * Ev ve deplasman golleri bağımsız Poisson kabul edilerek
 * P(toplam gol >= 3 VE iki takım da gol attı).
 * İki takımın da gol attığı skorlardan toplamı 3'ün altında kalan tek skor 1-1'dir.
 */
export const probOver25AndBtts = (homeXg: number, awayXg: number): number => {
  const bothScore = (1 - Math.exp(-homeXg)) * (1 - Math.exp(-awayXg))
  const oneOne = poissonPmf(1, homeXg) * poissonPmf(1, awayXg)
  return Math.max(0, bothScore - oneOne)
}
