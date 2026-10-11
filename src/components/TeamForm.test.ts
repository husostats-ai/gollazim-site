import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TeamForm, { csText, FORM_TITLE, formLetters, formSpoken, GOALS_TITLE, type TeamFormValue } from './TeamForm'

const FULL: TeamFormValue = { last: 'WWDDL', gf: 6, ga: 4, cs: 60 }
const render = (props: Parameters<typeof TeamForm>[0]): string => renderToStaticMarkup(createElement(TeamForm, props))
const visible = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('form harfleri', () => {
  it('W/D/L -> G/B/M; sıra korunur (en sağdaki en yeni)', () => {
    expect(formLetters('WWDDL').map((l) => l.letter)).toEqual(['G', 'G', 'B', 'B', 'M'])
    expect(formLetters('LDW').map((l) => l.letter)).toEqual(['M', 'B', 'G'])
    expect(formLetters('W').map((l) => l.label)).toEqual(['Galibiyet'])
    expect(formSpoken('WDL')).toBe('Galibiyet, Beraberlik, Mağlubiyet')
  })

  it('her sonucun kendi rengi vardır; harf her zaman yazar', () => {
    const [g, b, m] = formLetters('WDL')
    expect(g.tone).toContain('text-win')
    expect(b.tone).toContain('text-warn')
    expect(m.tone).toContain('text-loss-text')
    expect(new Set([g.tone, b.tone, m.tone]).size).toBe(3)
  })

  it('eksik, boş ya da bozuk form: kutucuk yok (uydurulmaz)', () => {
    for (const bad of [null, '', 'WWXDL', 'wwdl', 'WWWWWW', 'G']) expect(formLetters(bad), String(bad)).toEqual([])
  })
})

describe('form satırları', () => {
  it('iki taraf: başlık, harfler, gol ve gol yemediği maç', () => {
    const html = render({ home: FULL, away: { last: 'LDW', gf: 4, ga: 5, cs: 20 } })
    const text = visible(html)
    expect(text).toContain(`${FORM_TITLE} · ${GOALS_TITLE}`)
    expect(FORM_TITLE).toBe('Son 5 maç (sağdaki en yeni)')
    expect(text).toContain('Ev Galibiyet, Galibiyet, Beraberlik, Beraberlik, Mağlubiyet G G B B M Gol: 6–4 Gol yemediği maç: %60')
    expect(text).toContain('Dep Mağlubiyet, Beraberlik, Galibiyet M B G Gol: 4–5 Gol yemediği maç: %20')
    expect(csText(25)).toBe('Gol yemediği maç: %25')
    // Renk tek başına anlam taşımaz: kutucuklar süs sayılır, ekran okuyucu tam adları okur.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(8)
    expect(html).toContain('class="sr-only"')
    // İpucu (title) yoktur: üye sayfasında yasaktır; "Gol"ün anlamı başlıkta yazar.
    expect(html).not.toMatch(/\stitle="/)
    expect(GOALS_TITLE).toBe('Gol: attığı–yediği')
  })

  it('eksik alan yazılmaz: form yoksa kutucuk, CS yoksa satırı yok', () => {
    const html = render({ home: { last: null, gf: 0, ga: 0, cs: null }, away: null })
    expect(visible(html)).toBe(`${FORM_TITLE} · ${GOALS_TITLE} Ev Gol: 0–0`)
    expect(html).not.toContain('team-form-letters')
    expect(html).not.toContain('team-form-cs')
    expect(html).not.toContain('data-side="Dep"')
  })

  it('iki taraf da yoksa hiçbir şey çizilmez', () => {
    expect(render({ home: null, away: null })).toBe('')
  })

  it('not ve alt satır yalnızca verilirse çizilir (admin)', () => {
    const plain = render({ home: FULL, away: null })
    expect(plain).not.toContain('team-form-note')
    const admin = visible(render({ home: FULL, away: null, notes: { home: '⚠ tablo eski olabilir · üyeye gitmez' }, footer: 'CSV turu 6 · tablo MP 4 / 5' }))
    expect(admin).toContain('Gol: 6–4 Gol yemediği maç: %60 ⚠ tablo eski olabilir · üyeye gitmez')
    expect(admin.endsWith('CSV turu 6 · tablo MP 4 / 5')).toBe(true)
  })

  it('üye sayfasında yasak kelime yok: metinler ve çizilen satırlar', () => {
    const FORBIDDEN = /oran|piyasa|xg|csv|kaynak|footystats|bağlantı|https?:|www\.|odds|ortalama|bahis|kupon|iddaa|banko|clean sheet|\bkg\b/
    const member = visible(render({ home: FULL, away: FULL })).toLocaleLowerCase('tr')
    expect(FORBIDDEN.exec(member)?.[0] ?? null).toBeNull()
    for (const text of [FORM_TITLE, GOALS_TITLE, csText(25), formSpoken('WDL')]) expect(FORBIDDEN.exec(text.toLocaleLowerCase('tr'))?.[0] ?? null, text).toBeNull()
  })
})
