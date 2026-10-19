import { describe, expect, it } from 'vitest'
import { countryOf, leagueFlag } from './countryFlag'
import { FLAG_SVGS } from './flags'

describe('lig satırı bayrağı', () => {
  it('ülke lig metninin " · " öncesinden türetilir', () => {
    expect(countryOf('Netherlands · Eredivisie')).toBe('Netherlands')
    expect(countryOf('Saudi Arabia · Pro League')).toBe('Saudi Arabia')
    expect(countryOf('Eredivisie')).toBeNull()
  })

  it('İngiltere, İskoçya ve Galler alt-ulus bayraklarıdır', () => {
    expect(leagueFlag('England · Premier League')).toMatchObject({ kind: 'flag', code: 'gb-eng', name: 'İngiltere' })
    expect(leagueFlag('Scotland · Premiership')).toMatchObject({ kind: 'flag', code: 'gb-sct' })
    expect(leagueFlag('Wales · Cymru Premier')).toMatchObject({ kind: 'flag', code: 'gb-wls' })
  })

  it('kıta, uluslararası ve tanınmayan adlar nötr küreye düşer', () => {
    expect(leagueFlag('Europe · UEFA Youth League')).toEqual({ kind: 'globe', name: 'Avrupa' })
    expect(leagueFlag('Asia · AFC Champions League')).toEqual({ kind: 'globe', name: 'Asya' })
    expect(leagueFlag('International · Friendlies')).toEqual({ kind: 'globe', name: 'Uluslararası' })
    expect(leagueFlag('Atlantis · Lig')).toEqual({ kind: 'globe', name: 'Atlantis' })
    expect(leagueFlag('Eredivisie')).toBeNull()
  })

  it('her bayrak geçerli bir SVG ve kimlik çakışması yaratacak id içermez', () => {
    for (const [code, svg] of Object.entries(FLAG_SVGS)) {
      expect(svg.startsWith('<svg'), code).toBe(true)
      expect(svg.endsWith('</svg>'), code).toBe(true)
      expect(svg, code).not.toMatch(/id="flag-icons-/)
    }
  })
})
