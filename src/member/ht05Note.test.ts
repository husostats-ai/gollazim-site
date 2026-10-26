import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getCategory, HT05_NOTE, type CategoryId } from '../config/categories'
import { memberInput } from '../services/member/__fixtures__/rawData'
import { buildMemberPayload, type MemberItem } from '../services/member/payload'
import MemberCard from './MemberCard'

// Üye kartındaki İY 0.5 ÜST (*) notu: paketteki others alanından (yeni alan yok), admin kartıyla aynı kural.
const payload = buildMemberPayload(memberInput())
const today = payload.days[0]
const ht05 = today.lists.find((l) => l.categoryId === 'ht05')!.items[0]
const other = (categoryId: CategoryId) => ({ categoryId, percent: 80, reliability: 'medium' as const })

const render = (categoryId: CategoryId, others: CategoryId[]) => {
  const item: MemberItem = { ...ht05, others: others.map(other) }
  return renderToStaticMarkup(
    createElement(MemberCard, { rank: 1, match: today.matches[item.match], item, categoryId, categoryLabel: getCategory(categoryId).label, percentLabel: 'x', secondLabel: 'Model' }),
  )
}
const hasNote = (markup: string) => markup.includes('data-testid="member-ht05-note"')
const hasMark = (markup: string) => markup.includes('data-testid="member-ht05-note-mark"')

describe('üye kartı: İY 0.5 ÜST (*) notu', () => {
  it('ikisi de var: işaret ve metin aynen görünür', () => {
    const markup = render('ht05', ['over25', 'sh05'])
    expect(hasNote(markup) && hasMark(markup)).toBe(true)
    expect(markup).toContain(HT05_NOTE.replace("'", '&#x27;'))
  })

  it('yalnız biri, hiçbiri ya da İY başka kategorilerle (biri eksik): ne işaret ne metin', () => {
    for (const others of [['over25'], ['sh05'], [], ['btts', 'ht15', 'over25'], ['btts', 'ht15', 'sh05']] as CategoryId[][]) {
      const markup = render('ht05', others)
      expect(hasNote(markup) || hasMark(markup), others.join()).toBe(false)
    }
    expect(hasNote(render('ht05', ['btts', 'ht15', 'over25', 'sh05']))).toBe(true)
  })

  it('yalnızca İY 0.5 ÜST kartında: aynı koşulla 2.5 ÜST ve 2. YARI kartında görünmez', () => {
    for (const id of ['over25', 'sh05', 'btts'] as CategoryId[]) {
      const markup = render(id, ['over25', 'sh05', 'ht05'])
      expect(hasNote(markup) || hasMark(markup), id).toBe(false)
    }
  })

  it('others alanı olmayan (sürüm 1) öğede not yok, kart çizilir', () => {
    const { others: _others, ...old } = ht05
    const markup = renderToStaticMarkup(createElement(MemberCard, { rank: 1, match: today.matches[old.match], item: old as MemberItem, categoryId: 'ht05', categoryLabel: 'İLK YARI 0.5 ÜST', percentLabel: 'x', secondLabel: 'Model' }))
    expect(markup).toContain('data-testid="member-card"')
    expect(hasNote(markup)).toBe(false)
  })
})
