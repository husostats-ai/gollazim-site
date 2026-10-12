import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AdminTabBar from '../components/AdminTabBar'
import { STREAK_TITLE } from '../services/streak/texts'
import { ADMIN_SECTIONS, ADMIN_TABS, adminTabBadges, adminTabPath, DEFAULT_ADMIN_TAB, parseAdminTab, sectionsOfTab, type AdminBadgeInput, type AdminTabId } from './adminTabs'

describe('admin sekmeleri', () => {
  it('dört sekme vardır: GÜNLÜK, ÜYELER, AI ARAŞTIRMA, VERİ-YEDEK', () => {
    expect(ADMIN_TABS.map((tab) => tab.label)).toEqual(['GÜNLÜK', 'ÜYELER', 'AI ARAŞTIRMA', 'VERİ-YEDEK'])
    expect(new Set(ADMIN_TABS.map((tab) => tab.id)).size).toBe(4)
  })

  it('varsayılan sekme GÜNLÜK; boş ya da bilinmeyen değer GÜNLÜK sayılır', () => {
    expect(DEFAULT_ADMIN_TAB).toBe('gunluk')
    for (const value of [null, undefined, '', 'olmayan', 'GUNLUK', ' uyeler', 'uyeler ', '__proto__', 'toString']) expect(parseAdminTab(value)).toBe('gunluk')
    for (const tab of ADMIN_TABS) expect(parseAdminTab(tab.id)).toBe(tab.id)
  })

  it('sekmenin adresi: varsayılan parametresiz, diğerleri ?sekme=…; adres geri okununca aynı sekme', () => {
    expect(adminTabPath('gunluk')).toBe('/admin')
    expect(adminTabPath('uyeler')).toBe('/admin?sekme=uyeler')
    for (const tab of ADMIN_TABS) expect(parseAdminTab(new URLSearchParams(adminTabPath(tab.id).split('?')[1] ?? '').get('sekme'))).toBe(tab.id)
  })

  it('15 bölümün her biri tam bir sekmededir; boş sekme yoktur', () => {
    expect(ADMIN_SECTIONS).toHaveLength(15)
    expect(new Set(ADMIN_SECTIONS.map((section) => section.id)).size).toBe(15)
    expect(new Set(ADMIN_SECTIONS.map((section) => section.title)).size).toBe(15)
    const placed = ADMIN_TABS.flatMap((tab) => sectionsOfTab(tab.id))
    expect([...placed].sort()).toEqual(ADMIN_SECTIONS.map((section) => section.id).sort())
    for (const tab of ADMIN_TABS) expect(sectionsOfTab(tab.id).length).toBeGreaterThan(0)
    for (const section of ADMIN_SECTIONS) expect(ADMIN_TABS.some((tab) => tab.id === section.tab)).toBe(true)
  })

  it('yerleşim: GÜNLÜK 5, ÜYELER 4, AI ARAŞTIRMA 1, VERİ-YEDEK 5 kart; lig tablosu GÜNLÜK’te, CSV’nin hemen altında', () => {
    expect(sectionsOfTab('gunluk')).toEqual(['upload', 'league', 'highlights', 'streak', 'story'])
    expect(sectionsOfTab('uyeler')).toEqual(['publish', 'members', 'keyBackup', 'memberTexts'])
    expect(sectionsOfTab('ai')).toEqual(['rawCompare'])
    expect(sectionsOfTab('veri')).toEqual(['backup', 'matchEdit', 'thresholds', 'marketLimit', 'storyTexts'])
    expect(ADMIN_SECTIONS.find((section) => section.id === 'streak')?.title).toBe(STREAK_TITLE)
  })

  it('üç üye kartı (tek bileşen) art arda ve aynı sekmededir', () => {
    const ids = ADMIN_SECTIONS.map((section) => section.id)
    const at = ids.indexOf('publish')
    expect(ids.slice(at, at + 3)).toEqual(['publish', 'members', 'keyBackup'])
    expect(new Set(ADMIN_SECTIONS.slice(at, at + 3).map((section) => section.tab))).toEqual(new Set(['uyeler']))
  })
})

describe('sekme rozetleri', () => {
  const calm: AdminBadgeInput = { backupLevel: 'ok', keyBackupLevel: 'ok', siteLevel: 'ok', memberAttention: false }
  const none = { gunluk: null, uyeler: null, ai: null, veri: null }

  it('her şey yolundayken ve veri henüz okunmamışken rozet yok', () => {
    expect(adminTabBadges(calm)).toEqual(none)
    expect(adminTabBadges({ backupLevel: null, keyBackupLevel: null, siteLevel: null, memberAttention: false })).toEqual(none)
    expect(adminTabBadges({ backupLevel: 'none', keyBackupLevel: 'none', siteLevel: 'unknown', memberAttention: false })).toEqual(none)
  })

  it('VERİ-YEDEK: veri yedeği güncel değilse', () => {
    for (const backupLevel of ['warn', 'alert', 'never'] as const) expect(adminTabBadges({ ...calm, backupLevel })).toEqual({ ...none, veri: 'Veri yedeği güncel değil' })
  })

  it('ÜYELER: anahtar yedeği eskiyse, şifre kutusu / yayın hatası açıksa, üye sitesi paketi açamıyorsa', () => {
    expect(adminTabBadges({ ...calm, keyBackupLevel: 'never' }).uyeler).toBe('Üye anahtar yedeği güncel değil')
    expect(adminTabBadges({ ...calm, keyBackupLevel: 'stale' }).uyeler).toBe('Üye anahtar yedeği güncel değil')
    expect(adminTabBadges({ ...calm, memberAttention: true }).uyeler).toContain('şifre kutusu')
    expect(adminTabBadges({ ...calm, siteLevel: 'incompatible' }).uyeler).toContain('açamıyor')
    expect(adminTabBadges({ ...calm, keyBackupLevel: 'never' }).veri).toBeNull()
  })

  it('"üye sitesi eski olabilir" (older) rozet yakmaz', () => {
    expect(adminTabBadges({ ...calm, siteLevel: 'older' })).toEqual(none)
  })

  it('GÜNLÜK ve AI ARAŞTIRMA sekmelerinde rozet hiç yanmaz (lig tablosu dahil hiçbir bölümü rozet üretmez)', () => {
    const worst = adminTabBadges({ backupLevel: 'never', keyBackupLevel: 'never', siteLevel: 'incompatible', memberAttention: true })
    expect(worst.gunluk).toBeNull()
    expect(worst.ai).toBeNull()
  })
})

describe('sekme çubuğu (tarayıcısız çizim)', () => {
  const none: Record<AdminTabId, string | null> = { gunluk: null, uyeler: null, ai: null, veri: null }
  const draw = (active: AdminTabId, badges = none) => renderToStaticMarkup(createElement(AdminTabBar, { active, badges, onSelect: () => undefined }))
  const tabs = (markup: string) => markup.match(/<button[^>]*role="tab"[^>]*>/g) ?? []

  it('dört sekme düğmesi çizilir; yalnızca aktif olan seçilidir', () => {
    for (const tab of ADMIN_TABS) {
      const buttons = tabs(draw(tab.id))
      expect(buttons).toHaveLength(4)
      const selected = buttons.filter((button) => button.includes('aria-selected="true"'))
      expect(selected).toHaveLength(1)
      expect(selected[0]).toContain(`id="admin-tab-${tab.id}"`)
      expect(selected[0]).toContain(`aria-controls="admin-panel-${tab.id}"`)
      expect(selected[0]).toContain('bg-brand')
    }
  })

  it('etiketler sırayla görünür', () => {
    const text = draw('gunluk').replace(/<[^>]+>/g, '|')
    expect(text.split('|').filter(Boolean)).toEqual(['GÜNLÜK', 'ÜYELER', 'AI ARAŞTIRMA', 'VERİ-YEDEK'])
  })

  it('rozet yalnızca nedeni olan sekmede çizilir ve nedeni okunur', () => {
    expect(draw('gunluk')).not.toContain('admin-tab-badge-')
    const markup = draw('gunluk', { ...none, veri: 'Veri yedeği güncel değil' })
    expect(markup.match(/admin-tab-badge-/g)).toHaveLength(1)
    expect(markup).toContain('data-testid="admin-tab-badge-veri"')
    expect(markup).toContain('aria-label="Uyarı: Veri yedeği güncel değil"')
  })
})
