import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// YALITIM: maç notu yalnızca gösterimdir. Analiz, istatistik (ve dışa aktarımı), yapay zekâ prompt'ları,
// Story/Instagram görselleri ve Telegram/paylaşım metinleri notu hiç okumaz. Bu modüllerin hiçbiri not
// modüllerini, not deposunu ya da not tipini kullanamaz; kullanmaya başlarsa bu test kırılır.

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })

/** Notu okuyamayacak kod: klasörler ve tek tek dosyalar */
const ISOLATED_DIRS = ['src/services/analysis', 'src/services/stats', 'src/services/ai', 'src/services/story', 'src/services/image', 'src/services/csv', 'src/services/results', 'src/services/rawCompare', 'src/services/referans', 'src/services/highlights', 'src/services/streak', 'src/services/daily', 'src/services/league', 'src/components/stats', 'src/components/ai']
const ISOLATED_FILES = ['src/pages/StatsPage.tsx', 'src/pages/AiPage.tsx', 'src/components/StoryButton.tsx', 'src/components/StoryPanel.tsx', 'src/components/StoryTextsPanel.tsx', 'src/components/CaptionBox.tsx', 'src/components/RawComparePanel.tsx', 'src/components/member/MemberTextsPanel.tsx']
const NOTE_USE = /notes\/(matchNote|noteImage)|matchNotes|\bMatchNote(Image)?\b|MatchNotePanel/

describe('maç notu: hesaplara ve dışa çıkan metinlere girmez', () => {
  const targets = [...ISOLATED_DIRS.flatMap(files), ...ISOLATED_FILES]

  it('denetlenen dosyalar gerçekten var', () => {
    expect(targets.length).toBeGreaterThan(80)
    for (const file of ISOLATED_FILES) expect(statSync(file).isFile(), file).toBe(true)
  })

  it('analiz, istatistik, AI, Story/Instagram, paylaşım metni ve CSV kodu notu kullanmaz', () => {
    expect(targets.filter((file) => NOTE_USE.test(readFileSync(file, 'utf8')))).toEqual([])
  })
})
