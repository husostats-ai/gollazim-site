import { leagueFlag } from './countryFlag'
import LeagueEmblem from '../components/LeagueEmblem'

/** Kıta, uluslararası ve tanınmayan bölgeler için nötr küre; rengi kartın soluk metin rengidir */
const GLOBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8ea4b8" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3C9.5 5.5 8.2 8.5 8.2 12s1.3 6.5 3.8 9"/></svg>'

const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

/** Lig satırının başındaki küçük bayrak (ya da Avrupa kupası rozeti, ya da nötr küre); hepsi 20 px genişliğinde kutuda */
export default function CountryFlag({ league }: { league: string }) {
  const flag = leagueFlag(league)
  if (!flag) return null
  if (flag.kind === 'emblem') return <LeagueEmblem league={league} testId="member-flag" />
  const isFlag = flag.kind === 'flag'
  return (
    <img
      src={dataUri(isFlag ? flag.svg : GLOBE_SVG)}
      alt={flag.name}
      width={20}
      height={15}
      className={`h-[15px] w-5 shrink-0 ${isFlag ? 'rounded-[3px] object-cover ring-1 ring-white/25' : 'object-contain'}`}
      data-testid="member-flag"
      data-flag={isFlag ? flag.code : 'globe'}
    />
  )
}
