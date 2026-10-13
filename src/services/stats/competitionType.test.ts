import { describe, expect, it } from 'vitest'
import type { CompetitionType } from '../../config/competitionTypes'
import { competitionOf, competitionTypeOf, isReserveTeam } from './competitionType'

const type = (league: string, home = 'Ev', away = 'Dep'): CompetitionType => competitionTypeOf({ league, home, away })

describe('lig türü sınıflandırması', () => {
  it('gençlik: lig adında Youth League / yaş grubu / gençlik ligi sözcüğü', () => {
    expect(type('Europe · UEFA Youth League', 'Real Madrid', 'Ajax')).toBe('youth')
    expect(type('Iceland · U19 League')).toBe('youth')
    expect(type('England · U18 Premier League')).toBe('youth')
    expect(type('England · Professional Development League')).toBe('youth')
    expect(type('Brazil · Copa São Paulo de Juniores')).toBe('youth')
    expect(type('Italy · Primavera 1')).toBe('youth')
  })

  it('gençlik: takım adında U17–U23 (lig yetişkin kupası olsa bile)', () => {
    expect(type('England · EFL Trophy', 'Doncaster Rovers', 'Liverpool U21')).toBe('youth')
    expect(type('England · EFL Trophy', 'Milton Keynes Dons', 'Brentford FC U21')).toBe('youth')
    expect(type('Europe · UEFA U21 Championship Qualification', 'France U21 National Team', 'Switzerland U21')).toBe('youth')
    expect(type('Europe · UEFA U21 Championship Qualification', 'Bulgaria U21', 'Scotland U20')).toBe('youth')
  })

  it('gençlik sözcükleri takım adında aranmaz', () => {
    expect(type('China · China League One', 'Shenzhen Juniors', 'Guangzhou E-Power')).toBe('league')
    expect(type('Scotland · League One', 'Alloa Athletic', 'Hamilton Academical')).toBe('league')
    expect(type('Germany · Bundesliga', 'Union Berlin', 'Elversberg')).toBe('league')
  })

  it('rezerv: " II", " III", " B", "Jong " ve adı listede olan takımlar', () => {
    for (const team of ['Stuttgart II', 'Hoffenheim II', 'Real Madrid III', 'Barcelona B', 'Jong Ajax', 'KuPS Akatemia', 'Klubi-04']) {
      expect(isReserveTeam(team), team).toBe(true)
    }
    expect(type('Germany · 3. Liga', 'Meppen', 'Stuttgart II')).toBe('reserve')
    expect(type('Finland · Ykkösliiga', 'Klubi-04', 'EIF')).toBe('reserve')
    expect(type('Netherlands · Eerste Divisie', 'Jong PSV', 'VVV')).toBe('reserve')
  })

  it('rezerv kuralına benzeyen yetişkin kulüpler rezerv sayılmaz', () => {
    for (const team of ['Willem II', 'Jong Colombia', 'Jong Holland', 'Bayer Leverkusen', 'Jonge Kracht', 'FC Jongeren', 'Club Brugge', 'BK Häcken', 'SC Freiburg', 'Hapoel Be\'er Sheva', 'Sporting CP', 'Vitória SC', 'Racing Club', 'KFUM', 'Napoli', 'Henri IV']) {
      expect(isReserveTeam(team), team).toBe(false)
    }
    expect(type('Netherlands · Eredivisie', 'Utrecht', 'Willem II')).toBe('league')
  })

  it('milli takım: ülke alanı International ya da milli takım yarışması; kulüp yarışması değilse', () => {
    expect(type('International · UEFA Nations League', 'France', 'Belgium')).toBe('national')
    expect(type('International · ASEAN Cup', 'Indonesia', 'Thailand')).toBe('national')
    expect(type('International · International Friendlies', 'Turkey', 'Hungary')).toBe('national')
    expect(type('International · WC Qualification Europe', 'Italy', 'Poland')).toBe('national')
    expect(type('Africa · Africa Cup of Nations', 'Egypt', 'Ghana')).toBe('national')
    expect(type('International · Club Friendlies', 'Ajax', 'Genk')).toBe('cup')
    expect(type('International · FIFA Club World Cup', 'Real Madrid', 'Al Ahly')).toBe('cup')
  })

  it('kupa: kıta kulüp yarışmaları ve ulusal kupalar', () => {
    expect(type('Europe · UEFA Champions League', 'Arsenal', 'Porto')).toBe('cup')
    expect(type('Europe · UEFA Europa Conference League')).toBe('cup')
    expect(type('Asia · AFC Champions League', 'Al Nassr', 'Neftchi')).toBe('cup')
    expect(type('Asia · ASEAN Club Championship', 'Buriram United', 'Borneo')).toBe('cup')
    expect(type('England · FA Cup')).toBe('cup')
    expect(type('England · EFL Trophy', 'Stevenage', 'Leicester City')).toBe('cup')
    expect(type('Japan · Emperor Cup', 'Yokohama F. Marinos', 'Kyoto Sangyo University SC')).toBe('cup')
    expect(type('Germany · DFB Pokal')).toBe('cup')
  })

  it('lig: geri kalan her şey; lig adı yoksa da lig', () => {
    expect(type('England · Premier League', 'Arsenal', 'Leeds United')).toBe('league')
    expect(type('Turkey · Süper Lig')).toBe('league')
    expect(type('England · Northern Premier League')).toBe('league')
    expect(competitionTypeOf({ home: 'A', away: 'B' })).toBe('league')
  })

  it('çakışmada öncelik: gençlik > rezerv > milli takım > kupa > lig', () => {
    // gençlik + rezerv
    expect(type('Netherlands · Eerste Divisie', 'Ajax II', 'Utrecht U21')).toBe('youth')
    // gençlik + milli takım + kupa (U21 elemeleri gençlikte kalır)
    expect(type('International · UEFA U21 Championship Qualification', 'Italy U21', 'Poland U21')).toBe('youth')
    // rezerv + kupa
    expect(type('Germany · DFB Pokal', 'Stuttgart II', 'Meppen')).toBe('reserve')
    // milli takım + kupa sözcüğü
    expect(type('International · ASEAN Cup')).toBe('national')
  })

  it('ülke ve lig CSV kolonlarından okunur; yoksa "Ülke · Lig" alanından', () => {
    expect(competitionOf({ league: 'Yanlış · Ad', home: 'A', away: 'B', stats: { country: 'International', league: 'UEFA Nations League' } })).toEqual({ country: 'International', league: 'UEFA Nations League' })
    expect(competitionOf({ league: 'England · FA Cup', home: 'A', away: 'B' })).toEqual({ country: 'England', league: 'FA Cup' })
    expect(competitionOf({ league: 'FA Cup', home: 'A', away: 'B' })).toEqual({ country: '', league: 'FA Cup' })
    expect(competitionTypeOf({ league: 'Lig', home: 'A', away: 'B', stats: { country: 'International', league: 'UEFA Nations League' } })).toBe('national')
  })
})
