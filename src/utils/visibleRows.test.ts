import { describe, expect, it } from 'vitest'
import { HISTORY_ROWS, HISTORY_ROWS_EXPANDED } from '../components/member/MemberAdminSection'
import { UPLOAD_ROWS } from '../components/UploadPanel'
import { visibleRows } from './visibleRows'

const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

describe('uzun listelerin gösterimi', () => {
  it('yüklenen dosyalar: kapalıyken son 3 kayıt, açıkken tümü', () => {
    expect(UPLOAD_ROWS).toBe(3)
    expect(visibleRows(rows(8), UPLOAD_ROWS, false)).toEqual([1, 2, 3])
    expect(visibleRows(rows(8), UPLOAD_ROWS, true)).toEqual(rows(8))
  })

  it('yayın geçmişi: kapalıyken son 5 satır, açıkken en çok 20', () => {
    expect([HISTORY_ROWS, HISTORY_ROWS_EXPANDED]).toEqual([5, 20])
    expect(visibleRows(rows(30), HISTORY_ROWS, false, HISTORY_ROWS_EXPANDED)).toEqual([1, 2, 3, 4, 5])
    expect(visibleRows(rows(30), HISTORY_ROWS, true, HISTORY_ROWS_EXPANDED)).toEqual(rows(20))
    expect(visibleRows(rows(7), HISTORY_ROWS, true, HISTORY_ROWS_EXPANDED)).toEqual(rows(7))
  })

  it('sınırdan az kayıt olduğu gibi gösterilir; boş liste boş kalır', () => {
    expect(visibleRows(rows(2), 3, false)).toEqual([1, 2])
    expect(visibleRows(rows(3), 3, false)).toEqual([1, 2, 3])
    expect(visibleRows([], 3, false)).toEqual([])
    expect(visibleRows([], 3, true)).toEqual([])
  })

  it('listeyi değiştirmez: veri aynen kalır, yalnızca gösterim kısalır', () => {
    const list = rows(10)
    const shown = visibleRows(list, 3, false)
    expect(list).toEqual(rows(10))
    expect(shown).not.toBe(list)
  })
})
