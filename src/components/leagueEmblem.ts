import uclEmblem from './emblems/ucl.png?inline'
import ueclEmblem from './emblems/uecl.png?inline'
import uelEmblem from './emblems/uel.png?inline'

// Avrupa kupası rozetleri: admin kartı ve üye kartı ortak kullanır. Rozetler scripts/turnuva-amblem.py
// ile logo-yeni/ altındaki logolardan üretilir ve data: adresi olarak pakete gömülür (dış adres yok,
// görsel indirmede tuval kirlenmez). Eşleşme tam lig metniyledir; benzer adlar (Youth League vb.) eşleşmez.

export type LeagueEmblem = { kind: 'emblem'; code: string; name: string; src: string }

/** Tam lig metni -> turnuva rozeti */
const EMBLEMS: Record<string, Omit<LeagueEmblem, 'kind'>> = {
  'Europe · UEFA Champions League': { code: 'ucl', name: 'UEFA Şampiyonlar Ligi', src: uclEmblem },
  'Europe · UEFA Europa League': { code: 'uel', name: 'UEFA Avrupa Ligi', src: uelEmblem },
  'Europe · UEFA Europa Conference League': { code: 'uecl', name: 'UEFA Konferans Ligi', src: ueclEmblem },
}

/** Ligin turnuva rozeti; yalnızca yukarıdaki tam lig adlarında, yoksa null */
export function leagueEmblem(league: string): LeagueEmblem | null {
  const emblem = EMBLEMS[league.trim()]
  return emblem ? { kind: 'emblem', ...emblem } : null
}
