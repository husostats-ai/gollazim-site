import { leagueEmblem } from './leagueEmblem'

/**
 * Avrupa kupası rozeti (UCL / UEL / UECL); başka liglerde hiçbir şey çizmez. 18 px çaplı rozet,
 * bayrağın 20 px genişliğindeki kutusunda ortalanır: lig adı bayraklı satırlarla aynı hizada başlar.
 */
export default function LeagueEmblem({ league, testId }: { league: string; testId: string }) {
  const emblem = leagueEmblem(league)
  if (!emblem) return null
  return (
    <img
      src={emblem.src}
      alt={emblem.name}
      width={20}
      height={18}
      className="h-[18px] w-5 shrink-0 object-contain"
      data-testid={testId}
      data-flag={emblem.code}
    />
  )
}
