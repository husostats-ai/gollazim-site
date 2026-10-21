import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LeagueEmblem from './LeagueEmblem'
import { leagueEmblem } from './leagueEmblem'

const render = (league: string) => renderToStaticMarkup(createElement(LeagueEmblem, { league, testId: 'league-emblem' }))

describe('Avrupa kupası rozeti', () => {
  it('yalnızca üç tam lig adıyla eşleşir; rozet pakete gömülü PNG\'dir', () => {
    expect(leagueEmblem('Europe · UEFA Champions League')).toMatchObject({ kind: 'emblem', code: 'ucl', name: 'UEFA Şampiyonlar Ligi' })
    expect(leagueEmblem('Europe · UEFA Europa League')).toMatchObject({ kind: 'emblem', code: 'uel', name: 'UEFA Avrupa Ligi' })
    expect(leagueEmblem('Europe · UEFA Europa Conference League')).toMatchObject({ kind: 'emblem', code: 'uecl', name: 'UEFA Konferans Ligi' })
    expect(leagueEmblem('  Europe · UEFA Champions League ')?.code).toBe('ucl')
    for (const code of ['ucl', 'uel', 'uecl']) {
      const league = { ucl: 'Europe · UEFA Champions League', uel: 'Europe · UEFA Europa League', uecl: 'Europe · UEFA Europa Conference League' }[code]!
      expect(leagueEmblem(league)!.src.startsWith('data:image/png;base64,'), code).toBe(true)
    }
  })

  it('logosu olmayan turnuvalar ve benzer adlar eşleşmez (geri dönüş)', () => {
    for (const league of [
      'Europe · UEFA Youth League',
      'International · UEFA Nations League',
      'Asia · AFC Champions League',
      'Asia · AFC Cup',
      'Europe · UEFA Champions League Qualification',
      'Europe · UEFA Europa League U19',
      'UEFA Champions League',
      'europe · uefa champions league',
      'England · Premier League',
    ]) expect(leagueEmblem(league), league).toBeNull()
  })

  it('admin kartı: rozet yalnızca Avrupa kupalarında çizilir; bayrak ve küre çizilmez', () => {
    const ucl = render('Europe · UEFA Champions League')
    expect(ucl).toContain('data-testid="league-emblem"')
    expect(ucl).toContain('data-flag="ucl"')
    expect(ucl).toContain('alt="UEFA Şampiyonlar Ligi"')
    expect(ucl).toContain('height="18"')
    for (const league of ['England · Premier League', 'Turkey · Süper Lig', 'Europe · UEFA Youth League', 'Asia · AFC Champions League', 'Eredivisie']) expect(render(league), league).toBe('')
  })

  it('admin kartı üye bayrağını içe aktarmaz; lig satırı rozet yoksa eskisi gibi düz metindir', () => {
    const card = readFileSync('src/components/MatchCard.tsx', 'utf8')
    expect(card).not.toMatch(/CountryFlag|countryFlag|\.\.\/member\//)
    expect(card).toContain('<LeagueEmblem league={match.league} testId="league-emblem" />')
    expect(card).toContain('<span className="min-w-0 truncate">{match.league}</span>')
  })
})
