import type { CategoryId } from './categories'

// Story görsellerinde ve açıklama metinlerinde kategori adının altında yazan kısa
// tanım. Her metin, services/results/evaluator.ts içindeki kazanma kuralının
// sözle ifadesidir; kural değişirse buradaki metin de değişmelidir (testle denetlenir).
export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  over25: 'Maçta 3 veya daha fazla gol',
  ht05: 'İlk yarıda en az 1 gol',
  btts: 'İki takım da en az 1 gol atar',
  over25btts: '3+ gol ve iki takım da gol atar',
  sh05: 'İkinci yarıda en az 1 gol',
  over35: 'Maçta 4 veya daha fazla gol',
  over45: 'Maçta 5 veya daha fazla gol',
  ht15: 'İlk yarıda en az 2 gol',
  corners85: 'Maçta 9 veya daha fazla korner',
  corners95: 'Maçta 10 veya daha fazla korner',
  corners105: 'Maçta 11 veya daha fazla korner',
  cards35: 'Maçta 4 veya daha fazla kart (sarı + kırmızı)',
  cards45: 'Maçta 5 veya daha fazla kart (sarı + kırmızı)',
  homeWin15: 'Ev sahibi kazanır ve maçta 2 veya daha fazla gol',
  homeWin25: 'Ev sahibi kazanır ve maçta 3 veya daha fazla gol',
  awayWin15: 'Deplasman kazanır ve maçta 2 veya daha fazla gol',
  awayWin25: 'Deplasman kazanır ve maçta 3 veya daha fazla gol',
}
