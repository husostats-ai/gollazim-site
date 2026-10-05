import { describe, expect, it } from 'vitest'
import { parseScores, type ScoreDraft } from './validation'

const draft = (values: Partial<ScoreDraft> = {}): ScoreDraft => ({
  htHome: '',
  htAway: '',
  ftHome: '',
  ftAway: '',
  cornersHome: '',
  cornersAway: '',
  cardsHome: '',
  cardsAway: '',
  ...values,
})

const errorsOf = (d: ScoreDraft, status: Parameters<typeof parseScores>[1] = 'completed'): string[] => {
  const parsed = parseScores(d, status)
  return parsed.ok ? [] : parsed.errors
}

describe('parseScores', () => {
  it('geçerli skoru sayıya çevirir, boş alanları null bırakır', () => {
    const parsed = parseScores(draft({ htHome: '1', htAway: '0', ftHome: '3', ftAway: '1' }), 'completed')
    expect(parsed).toEqual({
      ok: true,
      scores: {
        htHome: 1,
        htAway: 0,
        ftHome: 3,
        ftAway: 1,
        cornersHome: null,
        cornersAway: null,
        cardsHome: null,
        cardsAway: null,
      },
    })
  })

  it('ilk yarı golü maç skorundan büyük olamaz', () => {
    expect(errorsOf(draft({ htHome: '2', htAway: '0', ftHome: '1', ftAway: '0' }))).toEqual([
      'Ev sahibinin ilk yarı golü (2) maç sonucundaki golünden (1) büyük olamaz.',
    ])
    expect(errorsOf(draft({ htHome: '0', htAway: '3', ftHome: '1', ftAway: '2' }))[0]).toMatch(/Deplasmanın ilk yarı golü \(3\)/)
    // eşitlik geçerlidir: tüm goller ilk yarıda atılmış olabilir
    expect(errorsOf(draft({ htHome: '2', htAway: '1', ftHome: '2', ftAway: '1' }))).toEqual([])
  })

  it('negatif, ondalıklı ve sayı olmayan değerleri reddeder', () => {
    expect(errorsOf(draft({ ftHome: '-1', ftAway: '2' }))[0]).toMatch(/Maç sonucu: .*“-1” geçersiz/)
    expect(errorsOf(draft({ ftHome: '1,5', ftAway: '2' }))[0]).toMatch(/tam sayı/)
    expect(errorsOf(draft({ ftHome: '2', ftAway: '1', cornersHome: 'x', cornersAway: '3' }))[0]).toMatch(/^Korner/)
  })

  it('bir çiftin tek tarafı girilirse uyarır', () => {
    expect(errorsOf(draft({ htHome: '0', htAway: '0', ftHome: '2', ftAway: '1', cardsHome: '3' }))).toEqual([
      'Toplam kart: iki takımın değeri birlikte girilmeli.',
    ])
  })

  it('tamamlandı için maç sonucu ve ilk yarı skoru zorunludur, diğer durumlarda değildir', () => {
    expect(errorsOf(draft({ htHome: '1', htAway: '0' }), 'completed')).toEqual([
      'Maç “Tamamlandı” olarak kaydedilecekse maç sonucu girilmeli.',
    ])
    expect(errorsOf(draft({ ftHome: '2', ftAway: '1' }), 'completed')).toEqual([
      'Maç “Tamamlandı” olarak kaydedilecekse ilk yarı skoru girilmeli.',
    ])
    expect(errorsOf(draft(), 'completed')).toHaveLength(2)
    // korner ve kart isteğe bağlı kalır
    expect(errorsOf(draft({ htHome: '1', htAway: '0', ftHome: '2', ftAway: '1' }), 'completed')).toEqual([])
    expect(errorsOf(draft({ htHome: '1', htAway: '0' }), 'pending')).toEqual([])
    expect(errorsOf(draft(), 'postponed')).toEqual([])
    expect(errorsOf(draft(), 'cancelled')).toEqual([])
  })
})
