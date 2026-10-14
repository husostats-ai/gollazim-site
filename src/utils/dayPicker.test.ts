import { describe, expect, it } from 'vitest'
import { pickDefaultDate } from '../state/AppContext'
import { calendarDayLabel, calendarRange, keyTarget, monthGrid, monthOf, monthTitle, QUICK_DAY_COUNT, shiftFocusMonth, shiftMonth, splitDates, WEEKDAYS } from './dayPicker'
import { formatDateChip, shiftDate } from './format'

const TODAY = '2026-10-14'
/** Bugünden geriye 0..n gün, en yeni başta (matchesRepo.listDates sırası) */
const back = (...days: number[]) => days.map((d) => shiftDate(TODAY, -d))

describe('gün seçici: hızlı düğmeler ve "Önceki günler"', () => {
  it('bugün − 6 … bugün hızlı düğmedir; daha eskisi takvime gider', () => {
    expect(QUICK_DAY_COUNT).toBe(7)
    const split = splitDates(back(0, 1, 2, 3, 4, 5, 6, 7, 8, 30), TODAY, TODAY)
    expect(split.quick).toEqual(back(0, 1, 2, 3, 4, 5, 6))
    expect(split.older).toEqual(back(7, 8, 30))
    expect(split.pinned).toBeNull()
  })

  it('bugün ve dün "Bugün" / "Dün", diğer hızlı günler "12 Eki" biçiminde yazılır', () => {
    const labels = splitDates(back(0, 1, 2, 6), TODAY, TODAY).quick.map((d) => formatDateChip(d, TODAY))
    expect(labels).toEqual(['Bugün', 'Dün', '12 Eki', '8 Eki'])
  })

  it('7 gün sınırı: bugün − 6 hızlıdır, bugün − 7 eskidir', () => {
    const split = splitDates(back(6, 7), TODAY, null)
    expect(split.quick).toEqual(['2026-10-08'])
    expect(split.older).toEqual(['2026-10-07'])
  })

  it('yalnızca verisi olan günler düğme olur; boş günler atlanır, sıra korunur', () => {
    const split = splitDates(back(0, 3, 5, 9), TODAY, TODAY)
    expect(split.quick).toEqual(back(0, 3, 5))
    expect(split.older).toEqual(back(9))
  })

  it('ileri tarihli gün ("Yarın") hızlı düğmelerde kalır', () => {
    const tomorrow = shiftDate(TODAY, 1)
    const split = splitDates([tomorrow, ...back(0, 1, 10)], TODAY, TODAY)
    expect(split.quick).toEqual([tomorrow, ...back(0, 1)])
    expect(formatDateChip(split.quick[0], TODAY)).toBe('Yarın')
    expect(split.older).toEqual(back(10))
  })

  it('seçili gün 7 günden eskiyse ayrıca gösterilir (pinned); hızlı günlerdeyse gösterilmez', () => {
    const dates = back(0, 1, 9, 20)
    expect(splitDates(dates, TODAY, shiftDate(TODAY, -20)).pinned).toBe(shiftDate(TODAY, -20))
    expect(splitDates(dates, TODAY, shiftDate(TODAY, -1)).pinned).toBeNull()
    // Verisi olmayan (listede bulunmayan) seçim sabitlenmez.
    expect(splitDates(dates, TODAY, shiftDate(TODAY, -15)).pinned).toBeNull()
  })

  it('varsayılan gün 7 günden eskiyse (son veri eski) seçili eski gün düğmesi çıkar; varsayılan gün kuralı aynı kalır', () => {
    const dates = [shiftDate(TODAY, 3), ...back(12, 13, 40)]
    const chosen = pickDefaultDate(dates, TODAY)
    expect(chosen).toBe(shiftDate(TODAY, -12))
    const split = splitDates(dates, TODAY, chosen)
    expect(split.quick).toEqual([shiftDate(TODAY, 3)])
    expect(split.pinned).toBe(chosen)
  })

  it('veri yoksa her şey boştur', () => {
    expect(splitDates([], TODAY, null)).toEqual({ quick: [], older: [], pinned: null })
    expect(calendarRange([])).toBeNull()
  })

  it('ay sonu ve yıl başında da 7 gün doğru sayılır (UTC metin hesabı)', () => {
    expect(splitDates(['2027-01-01', '2026-12-26', '2026-12-25'], '2027-01-01', null).older).toEqual(['2026-12-25'])
    expect(splitDates(['2024-03-01', '2024-02-24', '2024-02-23'], '2024-03-01', null).quick).toEqual(['2024-03-01', '2024-02-24'])
  })
})

describe('gün seçici: takvim', () => {
  it('hafta Pazartesi başlar; ızgara 6 hafta × 7 gündür', () => {
    const grid = monthGrid('2026-10')
    expect(grid).toHaveLength(6)
    expect(grid.every((week) => week.length === 7)).toBe(true)
    // 1 Ekim 2026 Perşembe: ilk satır 28 Eylül Pazartesi ile başlar.
    expect(grid[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    // 1'i Pazartesi olan ayda komşu ay günü başta yoktur (Haziran 2026).
    expect(monthGrid('2026-06')[0][0]).toBe('2026-06-01')
    // 1'i Pazar olan ay: önünde 6 gün (Kasım 2026).
    expect(monthGrid('2026-11')[0][6]).toBe('2026-11-01')
  })

  it('Türkçe gün ve ay adları', () => {
    expect(WEEKDAYS.map((d) => d.short)).toEqual(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'])
    expect(WEEKDAYS.map((d) => d.long)).toEqual(['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'])
    expect(monthTitle('2026-10')).toBe('Ekim 2026')
    expect(monthTitle('2027-02')).toBe('Şubat 2027')
    expect(calendarDayLabel('2026-10-14', TODAY, true)).toBe('14 Ekim 2026 Çarşamba, bugün')
    expect(calendarDayLabel('2026-10-03', TODAY, false)).toBe('3 Ekim 2026 Cumartesi, veri yok')
  })

  it('ay ve yıl geçişi', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2026-10', -10)).toBe('2025-12')
    expect(shiftMonth('2026-10', 15)).toBe('2028-01')
  })

  it('gezinme aralığı verisi olan en eski ayın ilk günü … en yeni ayın son günüdür', () => {
    expect(calendarRange(['2026-10-14', '2026-08-20', '2026-09-02'])).toEqual({ min: '2026-08-01', max: '2026-10-31' })
    expect(calendarRange(['2024-02-10'])).toEqual({ min: '2024-02-01', max: '2024-02-29' })
  })

  it('klavye: oklar, PageUp/PageDown, Home/End; aralık dışına çıkmaz', () => {
    const range = { min: '2026-09-01', max: '2026-10-31' }
    expect(keyTarget('2026-10-14', 'ArrowLeft', range)).toBe('2026-10-13')
    expect(keyTarget('2026-10-14', 'ArrowRight', range)).toBe('2026-10-15')
    expect(keyTarget('2026-10-14', 'ArrowUp', range)).toBe('2026-10-07')
    expect(keyTarget('2026-10-14', 'ArrowDown', range)).toBe('2026-10-21')
    expect(keyTarget('2026-10-14', 'Home', range)).toBe('2026-10-12')
    expect(keyTarget('2026-10-14', 'End', range)).toBe('2026-10-18')
    expect(keyTarget('2026-10-12', 'Home', range)).toBe('2026-10-12')
    expect(keyTarget('2026-10-18', 'End', range)).toBe('2026-10-18')
    expect(keyTarget('2026-10-14', 'PageUp', range)).toBe('2026-09-14')
    expect(keyTarget('2026-10-31', 'PageUp', range)).toBe('2026-09-30')
    // Aralık sınırı
    expect(keyTarget('2026-10-14', 'PageDown', range)).toBe('2026-10-31')
    expect(keyTarget('2026-09-01', 'ArrowLeft', range)).toBe('2026-09-01')
    expect(keyTarget('2026-10-30', 'ArrowDown', range)).toBe('2026-10-31')
    // Ay sınırını geçen ok bir sonraki aya geçer
    expect(keyTarget('2026-09-30', 'ArrowRight', range)).toBe('2026-10-01')
    expect(keyTarget('2026-10-14', 'Enter', range)).toBeNull()
  })

  it('yıl sınırında ay ve gün gezinmesi', () => {
    const range = { min: '2026-11-01', max: '2027-02-28' }
    expect(keyTarget('2026-12-31', 'ArrowRight', range)).toBe('2027-01-01')
    expect(keyTarget('2027-01-31', 'PageDown', range)).toBe('2027-02-28')
    expect(keyTarget('2027-01-15', 'PageUp', range)).toBe('2026-12-15')
    expect(shiftFocusMonth('2026-12-31', 1, range)).toBe('2027-01-31')
    expect(shiftFocusMonth('2026-11-10', -1, range)).toBe('2026-11-01')
  })
})
