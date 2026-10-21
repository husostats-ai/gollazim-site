import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CountryFlag from './CountryFlag'
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

  it('Avrupa kupaları küre yerine rozet gösterir; logosu olmayan kıta turnuvaları küreye düşer', () => {
    expect(leagueFlag('Europe · UEFA Champions League')).toMatchObject({ kind: 'emblem', code: 'ucl' })
    expect(leagueFlag('Europe · UEFA Europa League')).toMatchObject({ kind: 'emblem', code: 'uel' })
    expect(leagueFlag('Europe · UEFA Europa Conference League')).toMatchObject({ kind: 'emblem', code: 'uecl' })
    expect(leagueFlag('International · UEFA Nations League')).toEqual({ kind: 'globe', name: 'Uluslararası' })
    expect(leagueFlag('Asia · AFC Cup')).toEqual({ kind: 'globe', name: 'Asya' })
    expect(leagueFlag('Europe · UEFA Champions League Qualification')).toEqual({ kind: 'globe', name: 'Avrupa' })
  })

  it('üye kartı: rozet, bayrak ve küre aynı test kimliğiyle ve 20 px genişliğinde kutuda çizilir', () => {
    const html = (league: string) => renderToStaticMarkup(createElement(CountryFlag, { league }))
    expect(html('Europe · UEFA Europa League')).toMatch(/data-testid="member-flag" data-flag="uel"/)
    expect(html('Europe · UEFA Europa League')).toContain('src="data:image/png;base64,')
    expect(html('Europe · UEFA Youth League')).toContain('data-flag="globe"')
    expect(html('Germany · Bundesliga')).toContain('data-flag="de"')
    for (const league of ['Europe · UEFA Europa League', 'Europe · UEFA Youth League', 'Germany · Bundesliga']) expect(html(league), league).toContain('width="20"')
  })

  it('her bayrak geçerli bir SVG ve kimlik çakışması yaratacak id içermez', () => {
    for (const [code, svg] of Object.entries(FLAG_SVGS)) {
      expect(svg.startsWith('<svg'), code).toBe(true)
      expect(svg.endsWith('</svg>'), code).toBe(true)
      expect(svg, code).not.toMatch(/id="flag-icons-/)
    }
  })
})
