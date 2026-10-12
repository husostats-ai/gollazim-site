/**
 * Uzun listenin ekranda gösterilecek kısmı: kapalıyken ilk `limit` satır, açıkken en çok
 * `expandedLimit` satır. Yalnızca gösterimi kısaltır; liste değişmez.
 */
export const visibleRows = <T>(rows: readonly T[], limit: number, expanded: boolean, expandedLimit = Infinity): T[] => rows.slice(0, expanded ? expandedLimit : limit)
