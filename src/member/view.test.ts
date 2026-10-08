import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../config/categories'
import { DEFAULT_MEMBER_TEXTS } from '../config/memberTexts'
import { MEMBER_STALE_HOURS } from '../config/member'
import { DAY, dayHighlights, HIGHLIGHT_PERCENT, memberInput, PREVIOUS_DAY, PUBLISHED_AT } from '../services/member/__fixtures__/rawData'
import type { MemberErrorKind } from '../services/member/controller'
import { MEMBER_ERROR_TEXTS, MEMBER_HIGHLIGHT_TEXTS, MEMBER_NOTICE_TEXTS, STALE_DATA_TEXT } from '../services/member/labels'
import { buildMemberPayload } from '../services/member/payload'
import { formatRate } from '../utils/format'
import { HOW_TO_READ, HOW_TO_READ_TITLE } from './howToRead'
import MemberAnalysis from './MemberAnalysis'
import MemberLogin from './MemberLogin'
import { LEGAL_NOTICE } from './legalNotice'
import MemberShell from './MemberShell'
import MemberStatsPage from './MemberStatsPage'
import { CALCULATORS } from '../services/analysis/calculators'
import { makeMatch } from '../services/analysis/testUtils'
import type { MemberPayload } from '../services/member/payload'
import { categoryChoices, dayChip, dayTitle, isOverstated, isStale, listFor, PERCENT_LABELS, PERCENT_NOTE, percentKind, secondPercentLabel, updatedText } from './view'

// Üye sayfasının görünümü: bileşenler sunucu tarafı çizimle (tarayıcısız) HTML'e çevrilir.
// Tıklama gerektiren akışlar (gün ve kategori seçimi) açılış seçimi verilerek çizilir;
// gerçek tıklamalar Chrome'daki uçtan uca denemede sınanır.

const payload = buildMemberPayload(memberInput())
const NOW = Date.parse(PUBLISHED_AT) + 3_600_000
const HOUR = 3_600_000

const html = (element: ReactElement, path = '/uye'): string => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, element))
/** Etiketler atılmış görünen metin */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const noop = () => undefined

const shell = (children: ReactElement, now = NOW, refreshError: MemberErrorKind | null = null, p = payload) =>
  html(createElement(MemberShell, { payload: p, now, today: DAY, refreshError, onLogout: noop, children }))
const analysis = (initialDay = 0, initialCategory?: (typeof CATEGORIES)[number]['id']) => createElement(MemberAnalysis, { payload, today: DAY, initialDay, initialCategory })

describe('gösterim yardımcıları', () => {
  it('son güncelleme saati Türkiye saatiyle; yayın bugün değilse tarihiyle', () => {
    expect(updatedText(PUBLISHED_AT, DAY)).toBe('Son güncelleme: 09:30 (TSİ)')
    expect(updatedText(PUBLISHED_AT, '2026-10-06')).toBe('Son güncelleme: 5 Eki 2026 09:30 (TSİ)')
    // Gece yarısından sonra yapılan yayın ertesi güne aittir (TSİ).
    expect(updatedText('2026-10-05T21:30:00.000Z', '2026-10-06')).toBe('Son güncelleme: 00:30 (TSİ)')
  })

  it('paket 12 saatten eskiyse "güncel olmayabilir"', () => {
    const at = Date.parse(PUBLISHED_AT)
    expect(MEMBER_STALE_HOURS).toBe(12)
    expect(isStale(PUBLISHED_AT, at + 12 * HOUR, 12)).toBe(false)
    expect(isStale(PUBLISHED_AT, at + 12 * HOUR + 1, 12)).toBe(true)
    expect(isStale(PUBLISHED_AT, at + 2 * HOUR, 1)).toBe(true)
  })

  it('gün düğmeleri ve başlığı', () => {
    expect(dayChip(DAY, DAY)).toBe('Bugün')
    expect(dayChip(PREVIOUS_DAY, DAY)).toBe('Dün')
    expect(dayChip('2026-10-01', DAY)).toBe('1 Eki')
    expect(dayTitle(DAY)).toBe('5 Ekim 2026 analizleri')
  })

  it('kategori seçenekleri yalnızca dolu listelerdir; seçim yoksa ilk dolu liste gelir', () => {
    const day = payload.days[0]
    const choices = categoryChoices(day)
    expect(choices.map((c) => c.categoryId)).toEqual(day.lists.filter((l) => l.items.length > 0).map((l) => l.categoryId))
    expect(choices[0]).toMatchObject({ categoryId: 'over25', label: '2.5 ÜST', group: null })
    expect(choices.find((c) => c.categoryId === 'homeWin15')).toMatchObject({ group: 'TARAF & GOL' })
    expect(listFor(day, null)!.categoryId).toBe('over25')
    expect(listFor(day, 'corners85')!.categoryId).toBe('corners85')
    // Seçili kategori bu günde boşsa ilk dolu listeye dönülür.
    expect(listFor(payload.days[1], 'awayWin15')!.categoryId).toBe('over25')
    expect(listFor({ date: DAY, matches: [], lists: day.lists.map((l) => ({ ...l, items: [] })) }, null)).toBeNull()
  })
})

describe('yasal uyarı penceresi', () => {
  const login = (props: Partial<Parameters<typeof MemberLogin>[0]> = {}) => html(createElement(MemberLogin, { busy: false, error: null, notice: null, onLogin: noop, ...props }))
  const dialog = (markup: string) => /<div[^>]*role="dialog"[^>]*>/.exec(markup)

  it('giriş ekranı pencereyle açılır: başlık, üç paragraf, 18 yaş satırı ve iki düğme sabit metindir', () => {
    const markup = login()
    const tag = dialog(markup)![0]
    expect(tag).toContain('aria-modal="true"')
    expect(tag).toContain('aria-labelledby="member-legal-title"')
    const text = textOf(markup)
    expect(text).toContain('⚠️ Yasal Uyarı')
    expect(LEGAL_NOTICE.paragraphs).toHaveLength(3)
    for (const paragraph of LEGAL_NOTICE.paragraphs) expect(text).toContain(paragraph)
    // 18 yaş cümlesi kaydırılan gövdede değil, düğmelerin üstündeki sabit satırdadır.
    expect(LEGAL_NOTICE.age).toBe('Bu sayfayı yalnızca 18 yaşından büyükler kullanabilir.')
    const body = /data-testid="member-legal-body"[^>]*>(.*?)<\/div>/.exec(markup)![1]
    expect(body).not.toContain(LEGAL_NOTICE.age)
    expect(/data-testid="member-legal-age"[^>]*>([^<]*)/.exec(markup)![1]).toBe(LEGAL_NOTICE.age)
    expect(markup.indexOf('member-legal-body')).toBeLessThan(markup.indexOf('data-testid="member-legal-age"'))
    expect(markup.indexOf('data-testid="member-legal-age"')).toBeLessThan(markup.indexOf('member-legal-accept'))
    expect(/data-testid="member-legal-accept"[^>]*>([^<]*)/.exec(markup)![1]).toBe('18 yaşından büyüğüm, kabul ediyorum')
    expect(/data-testid="member-legal-decline"[^>]*>([^<]*)/.exec(markup)![1]).toBe('Kabul etmiyorum')
    // "Devam etmek için onay gerekir." yalnızca reddedince çıkar.
    expect(markup).not.toContain('member-legal-declined')
    expect(LEGAL_NOTICE.declined).toBe('Devam etmek için onay gerekir.')
  })

  it('kabul edilene kadar form etkisizdir: içerik inert, bütün alanlar ve düğmeler pasif', () => {
    const markup = login()
    expect(/<div[^>]*data-testid="member-login-content"[^>]*>/.exec(markup)![0]).toMatch(/inert=""/)
    const content = markup.slice(markup.indexOf('data-testid="member-login-content"'))
    const controls = [...content.matchAll(/<(input|button)\b[^>]*>/g)].map((m) => m[0])
    expect(controls.length).toBe(4)
    for (const control of controls) expect(control, control).toMatch(/\sdisabled=""/)
    // Hata sonrası "Yeniden dene" düğmesi de pasiftir.
    const retry = /<button[^>]*data-testid="member-retry"[^>]*>/.exec(login({ error: 'network', onRetry: noop }))![0]
    expect(retry).toMatch(/\sdisabled=""/)
  })

  it('kabul edildikten sonra pencere yoktur ve form kullanılabilir', () => {
    const markup = login({ initialAccepted: true })
    expect(dialog(markup)).toBeNull()
    expect(markup).not.toContain('inert')
    expect(markup).not.toMatch(/\sdisabled=""/)
  })

  it('metin yasak terim içermez; pakete ve admin metinlerine girmez', () => {
    const all = [LEGAL_NOTICE.title, ...LEGAL_NOTICE.paragraphs, LEGAL_NOTICE.age, LEGAL_NOTICE.accept, LEGAL_NOTICE.decline, LEGAL_NOTICE.declined].join(' ')
    expect(all.toLocaleLowerCase('tr')).not.toMatch(/oran|piyasa|xg|csv|kaynak|footystats|bağlantı|odds|ortalama|https?:|www\./)
    expect(JSON.stringify(payload)).not.toContain('Yasal Uyarı')
    expect(JSON.stringify(DEFAULT_MEMBER_TEXTS)).not.toContain('Yasal Uyarı')
  })
})

describe('giriş ekranı', () => {
  const login = (props: Partial<Parameters<typeof MemberLogin>[0]> = {}) => html(createElement(MemberLogin, { busy: false, error: null, notice: null, onLogin: noop, ...props }))

  it('alanlar şifre yöneticisine uygun; otomatik düzeltme ve büyük harf kapalı', () => {
    const markup = login()
    const username = /<input[^>]*name="username"[^>]*>/.exec(markup)![0]
    const password = /<input[^>]*name="password"[^>]*>/.exec(markup)![0]
    expect(username).toContain('autoComplete="username"')
    expect(password).toContain('autoComplete="current-password"')
    expect(password).toContain('type="password"')
    for (const input of [username, password]) {
      expect(input).toContain('autoCapitalize="none"')
      expect(input).toContain('autoCorrect="off"')
      expect(input).toContain('spellCheck="false"')
    }
    expect(markup).toContain('data-testid="member-password-toggle"')
    // Enter ile gönderilir: alanlar bir formun içindedir ve gönderme düğmesi vardır.
    expect(markup).toMatch(/<form[^>]*>[\s\S]*<button[^>]*type="submit"/)
  })

  it('giriş öncesi sabit uyarılar görünür; hata yokken hata metni yoktur', () => {
    const text = textOf(login())
    expect(text).toContain(DEFAULT_MEMBER_TEXTS.disclaimer)
    expect(text).toContain(DEFAULT_MEMBER_TEXTS.account)
    expect(login()).not.toContain('member-error')
  })

  it('yanlış girişte yalnızca genel hata metni', () => {
    const markup = login({ error: 'credentials' })
    expect(textOf(/<p role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(markup)![0])).toBe('Kullanıcı adı veya şifre hatalı.')
  })

  it('her hata türünün ayrı ve anlaşılır metni var', () => {
    const kinds = Object.keys(MEMBER_ERROR_TEXTS) as MemberErrorKind[]
    expect(kinds.sort()).toEqual(['corrupt', 'credentials', 'invalid', 'missing', 'network', 'outdated', 'unsupported'])
    expect(new Set(Object.values(MEMBER_ERROR_TEXTS)).size).toBe(kinds.length)
    for (const kind of kinds) expect(textOf(login({ error: kind }))).toContain(MEMBER_ERROR_TEXTS[kind])
  })

  it('türetme sırasında alanlar ve düğme devre dışı, ilerleme göstergesi açık', () => {
    const markup = login({ busy: true, initialAccepted: true })
    expect(markup).toContain('data-testid="member-progress"')
    expect(textOf(markup)).toContain('Giriş yapılıyor…')
    expect(markup.match(/disabled=""/g)!.length).toBe(3)
    expect(login()).not.toContain('member-progress')
  })

  it('"Yeniden dene" düğmesi yalnızca sürdürülebilir oturumda ve hata varken görünür', () => {
    expect(login({ error: 'network', onRetry: noop })).toContain('data-testid="member-retry"')
    expect(textOf(login({ error: 'network', onRetry: noop }))).toContain('Yeniden dene')
    expect(login({ error: 'network' })).not.toContain('member-retry')
    expect(login({ onRetry: noop })).not.toContain('member-retry')
  })

  it('oturum kapanma nedeni gösterilir', () => {
    expect(textOf(login({ notice: 'expired' }))).toContain(MEMBER_NOTICE_TEXTS.expired)
    expect(textOf(login({ notice: 'revoked' }))).toContain(MEMBER_NOTICE_TEXTS.revoked)
  })
})

describe('üye düzeni', () => {
  it('son güncelleme, yayın no ve paketten gelen uyarı metinleri', () => {
    const custom = buildMemberPayload(memberInput({ texts: { disclaimer: 'Özel uyarı metni.', account: 'Özel hesap notu.' } }))
    const text = textOf(shell(analysis(), NOW, null, custom))
    expect(text).toContain('Son güncelleme: 09:30 (TSİ)')
    expect(text).toContain('Yayın no 7')
    expect(text).toContain('Özel uyarı metni.')
    expect(text).toContain('Özel hesap notu.')
    expect(text).not.toContain(DEFAULT_MEMBER_TEXTS.account)
  })

  it('rota tabanı: ayrı üye sitesinde sekmeler kökte, eski adreste "/uye" altında', () => {
    const links = (markup: string) => [...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])
    const at = (basePath: string | undefined, path: string) =>
      renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(MemberShell, { payload, now: NOW, today: DAY, refreshError: null, onLogout: noop, ...(basePath !== undefined && { basePath }), children: analysis() })))
    expect(links(at('', '/'))).toEqual(['/', '/istatistik'])
    expect(links(at('/uye', '/uye'))).toEqual(['/uye', '/uye/istatistik'])
    expect(links(at(undefined, '/uye'))).toEqual(['/uye', '/uye/istatistik'])
    // Etkin sekme doğru işaretlenir.
    expect(/<a [^>]*aria-current="page"[^>]*href="\/"|<a [^>]*href="\/"[^>]*aria-current="page"/.test(at('', '/'))).toBe(true)
    expect(/href="\/istatistik"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/istatistik"/.test(at('', '/istatistik'))).toBe(true)
  })

  it('yalnızca iki sekme ve Çıkış vardır; admin gezinmesi yoktur', () => {
    const markup = shell(analysis())
    expect([...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/uye', '/uye/istatistik'])
    expect(markup).toContain('data-testid="member-logout"')
    const text = textOf(markup)
    for (const word of ['ADMİN', 'SKOR GİRİŞİ', 'AI ANALİZİ', 'CSV', 'Yedek', 'Görsele ekle', 'paylaşıldı']) expect(text).not.toContain(word)
  })

  it('yasal uyarı sayfanın en altında da yer alır (paketten gelen metinle)', () => {
    const custom = buildMemberPayload(memberInput({ texts: { disclaimer: 'Özel uyarı metni.', account: 'Özel hesap notu.' } }))
    const markup = shell(analysis(), NOW, null, custom)
    const footer = markup.slice(markup.indexOf('data-testid="member-footer"'))
    expect(textOf(footer)).toContain('Özel uyarı metni.')
    expect(textOf(footer)).toContain('Özel hesap notu.')
    // Alt bilgi içeriğin (kartların) altındadır.
    expect(markup.indexOf('data-testid="member-footer"')).toBeGreaterThan(markup.lastIndexOf('data-testid="member-card"'))
    expect(markup.indexOf('<footer')).toBeGreaterThan(markup.indexOf('data-testid="member-cards"'))
  })

  it('paket eskiyse uyarı çıkar, güncelse çıkmaz', () => {
    expect(textOf(shell(analysis(), NOW))).not.toContain(STALE_DATA_TEXT)
    expect(shell(analysis(), NOW)).not.toContain('member-stale')
    expect(textOf(shell(analysis(), Date.parse(PUBLISHED_AT) + 13 * HOUR))).toContain(STALE_DATA_TEXT)
  })

  it('yeni yayın denetlenemezse eldeki veri görünmeye devam eder ve uyarı çıkar', () => {
    const markup = shell(analysis(), NOW, 'network')
    expect(textOf(markup)).toContain(MEMBER_ERROR_TEXTS.network)
    expect(markup).toContain('data-testid="member-cards"')
  })
})

describe('kategori listeleri ve üye kartı', () => {
  const cards = (markup: string) => markup.split(/data-testid="member-card"[^>]*>/).slice(1).map(textOf)

  it('gün seçici: paketteki her gün için bir düğme; seçilen günün başlığı ve listesi çizilir', () => {
    const today = html(analysis(0))
    expect(textOf(today)).toContain('Bugün')
    expect(textOf(today)).toContain('Dün')
    expect(textOf(/data-testid="member-day-title"[^>]*>([^<]*)/.exec(today)![1])).toBe('5 Ekim 2026 analizleri')
    expect(/aria-selected="true"[^>]*data-testid="member-day-0"/.test(today)).toBe(true)

    const yesterday = html(analysis(1))
    expect(textOf(/data-testid="member-day-title"[^>]*>([^<]*)/.exec(yesterday)![1])).toBe('4 Ekim 2026 analizleri')
    expect(/aria-selected="true"[^>]*data-testid="member-day-1"/.test(yesterday)).toBe(true)
    expect(cards(yesterday)).toHaveLength(1)
    expect(cards(yesterday)[0]).toContain('Dünkü Ev – Dünkü Deplasman')
  })

  it('kart sayısı ve sırası paketteki listeyle aynıdır', () => {
    for (const list of payload.days[0].lists.filter((l) => l.items.length > 0)) {
      const drawn = cards(html(analysis(0, list.categoryId)))
      expect(drawn).toHaveLength(list.items.length)
      list.items.forEach((item, i) => {
        const match = payload.days[0].matches[item.match]
        expect(drawn[i].startsWith(`${i + 1} `), `${list.categoryId} #${i + 1}`).toBe(true)
        expect(drawn[i]).toContain(`${match.home} – ${match.away}`)
        expect(drawn[i]).toContain(`%${item.percent}`)
      })
    }
  })

  it('kart alanları: saat, lig, hazır yüzde, model, yıldız, geçmiş veri, çelişki, sıra, skor, sonuç', () => {
    const drawn = cards(html(analysis(0, 'over25')))
    const done = drawn.find((c) => c.includes('Kuzey Yıldızı'))!
    expect(done).toContain('12:00')
    expect(done).toContain('Testland · Deneme Ligi')
    expect(done).toContain('2.5 ÜST')
    expect(done).toContain('%88')
    expect(done).toMatch(/Model %\d+/)
    expect(done).toContain('✓ Tuttu')
    expect(done).toContain('İY 1-0 · MS 3-1')
    expect(done).toMatch(/Geçmiş veri: (Az|Orta|Çok) · en az \d+ maç/)
    expect(done).not.toMatch(/Güvenilirlik|Düşük|Yüksek/)
    expect(done).toContain('⚠ Model çelişkisi')
    expect(done).toContain('Ev: 1. sıra · 8 maç')
    expect(done).toContain('Dep: 4. sıra · 7 maç')
    expect(html(analysis(0, 'over25'))).toContain('aria-label="3 / 5 yıldız"')

    expect(drawn.find((c) => c.includes('Doğu Gençlik'))).toContain('✗ Tutmadı')
    expect(drawn.find((c) => c.includes('Ova Belediyespor'))).toContain('Ertelendi')
    // Skoru girilmemiş maçta sonuç ve skor yoktur.
    const open = drawn.find((c) => c.includes('Yayla Gençlerbirliği'))!
    expect(open).not.toMatch(/Tuttu|Tutmadı|MS \d/)
  })

  it('sonuç ayrıntısı ve dört sonuç işareti', () => {
    expect(cards(html(analysis(0, 'ht05'))).find((c) => c.includes('Kuzey Yıldızı'))).toContain('İY 1-0')
    const corners = cards(html(analysis(0, 'corners85')))
    expect(corners.find((c) => c.includes('Kuzey Yıldızı'))).toContain('Korner 12')
    expect(corners.find((c) => c.includes('Doğu Gençlik'))).toContain('— Değerlendirilemedi')
    expect(corners[0]).toContain('Geçmiş veri: Ölçülemedi')
    // Sayı çıkarılamayan seviyede maç sayısı yazmaz.
    expect(corners[0]).not.toContain('en az')
  })

  it('Taraf & Gol: "Model tabanlı" etiketi ve "Hesaplar çelişiyor" rozeti', () => {
    const side = html(analysis(0, 'homeWin15'))
    expect(textOf(side)).toMatch(/Model tabanlı/)
    expect(textOf(side)).not.toContain('Geçmiş veri: Model tabanlı')
    expect(textOf(side)).not.toContain('Güvenilirlik')
    expect(side).toContain('data-conflict="hesap"')
    expect(textOf(side)).toContain('⚠ Hesaplar çelişiyor')
    // Kartlarda (açıklama kutusunun dışında) "Model çelişkisi" rozeti yoktur.
    expect(cards(side).join(' ')).not.toContain('Model çelişkisi')
    // İkinci yüzdenin adı: Taraf & Gol'de "İkinci hesap", diğerlerinde "Model".
    expect(textOf(side)).toMatch(/İkinci hesap %\d+/)
    expect(textOf(side)).not.toMatch(/Model %\d+/)
    expect(textOf(html(analysis(0, 'over25')))).toMatch(/Model %\d+/)
    expect(cards(html(analysis(0, 'over25'))).join(' ')).not.toContain('İkinci hesap')
    expect(secondPercentLabel('awayWin25')).toBe('İkinci hesap')
    expect(secondPercentLabel('btts')).toBe('Model')
    expect(html(analysis(0, 'over25'))).not.toContain('data-conflict="hesap"')
  })

  it('"tablo eski" bayrağı yalnızca tablo eskiyse', () => {
    expect(cards(html(analysis(0, 'over25'))).join(' ')).not.toContain('tablo eski')
    const old = buildMemberPayload(memberInput({ publishedAt: '2026-10-20T06:30:00.000Z' }))
    const markup = html(createElement(MemberAnalysis, { payload: old, today: DAY, initialCategory: 'over25' }))
    expect(textOf(markup)).toContain('1. sıra · 8 maç · ⚠ tablo eski')
  })

  it('büyük yüzdenin altındaki etiket yüzdenin gerçekten ne olduğunu söyler', () => {
    // Etiket, yüzdenin hesaplandığı yöntemle birebir örtüşür: CSV'deki hazır yüzdeyi
    // doğrudan kullanan kategoriler "geçmiş sıklık", gerisi "model tahmini"dir.
    for (const category of CATEGORIES) expect(percentKind(category.id), category.id).toBe(CALCULATORS[category.id].basis.startsWith('CSV:') ? 'history' : 'model')
    expect(PERCENT_LABELS).toEqual({ history: 'Geçmiş maçlarda görülme sıklığı', model: 'Model tahmini' })
    const label = (categoryId: (typeof CATEGORIES)[number]['id']) => /data-testid="member-percent-label">([^<]*)/.exec(html(analysis(0, categoryId)))![1]
    for (const id of ['over25', 'ht05', 'btts', 'sh05', 'over35', 'ht15', 'corners85'] as const) expect(label(id), id).toBe('Geçmiş maçlarda görülme sıklığı')
    for (const id of ['over25btts', 'cards35', 'homeWin15', 'awayWin15'] as const) expect(label(id), id).toBe('Model tahmini')
    // Etiket her kartta vardır ve paketten gelmez (pakette böyle bir alan yoktur).
    const markup = html(analysis(0, 'over25'))
    expect(markup.split('data-testid="member-percent-label"').length - 1).toBe(markup.split('data-testid="member-card"').length - 1)
    expect(JSON.stringify(payload)).not.toContain('Geçmiş maçlarda')
  })

  it('kartların üstünde sabit açıklama satırı', () => {
    expect(PERCENT_NOTE).toBe("Yüzdeler geçmiş verilere ve model hesaplarına dayanan özetlerdir; sonucun kesin olduğu anlamına gelmez. Geçmiş veri 'Az' ise yüzde küçük bir örneğe dayanır.")
    const markup = html(analysis(0, 'over25'))
    expect(/data-testid="member-percent-note">([^<]*)/.exec(markup)![1].replace(/&#x27;/g, "'")).toBe(PERCENT_NOTE)
    expect(markup.indexOf('member-percent-note')).toBeLessThan(markup.indexOf('member-cards'))
    expect(html(createElement(MemberAnalysis, { payload: buildMemberPayload(memberInput({ days: [{ date: '2026-10-09', matches: [], results: [] }] })), today: DAY }))).not.toContain('member-percent-note')
  })

  it('"AI öneri güveni" satırı yalnızca satırı gelen maçın kartında görünür; skor tahmini, gerekçe ve risk yoktur', () => {
    const markup = html(analysis(0, 'over25'))
    const byTeam = (home: string) => cards(markup).find((c) => c.includes(home))!
    // 3/3 Orta
    expect(byTeam('Kuzey Yıldızı')).toContain('AI öneri güveni: ChatGPT: Orta Gemini: Orta Claude: Orta 3/3 · Orta')
    // 2 Güçlü + 1 Zayıf: zayıf diyen de dürüstçe görünür
    expect(byTeam('Doğu Gençlik')).toContain('AI öneri güveni: ChatGPT: Güçlü Gemini: Zayıf Claude: Güçlü 2/3 · Güçlü')
    // 2/3 Zayıf ve 2 Orta + 1 Eleme: maç listede durur, satır yoktur
    const without = cards(markup).filter((c) => !c.includes('AI öneri güveni'))
    expect(without.some((c) => c.includes('İç Anadolu FK'))).toBe(true)
    expect(cards(markup).filter((c) => c.includes('AI öneri güveni')).length).toBe(markup.split('data-testid="member-ai"').length - 1)
    expect(markup).not.toMatch(/Eleme|Skor olasılıkları|kanarya|Risk/)
    // "Geçmiş veri" etiketi satır çıksa da yerinde durur.
    expect(byTeam('Kuzey Yıldızı')).toContain('Geçmiş veri:')
    expect(markup.split('data-testid="member-reliability"').length).toBe(markup.split('data-testid="member-card"').length)
    // Aynı maç başka listede de varsa satır orada da görünür.
    const other = payload.days[0].lists.find((l) => l.categoryId !== 'over25' && l.items.some((i) => payload.days[0].matches[i.match].home === 'Kuzey Yıldızı'))!
    expect(cards(html(analysis(0, other.categoryId))).find((c) => c.includes('Kuzey Yıldızı'))).toContain('3/3 · Orta')
    // Sürüm 5 paket (satır yok): kart eskisi gibi çizilir.
    const v5 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    for (const d of v5.days) for (const m of d.matches) delete m.ai
    expect(html(createElement(MemberAnalysis, { payload: v5, today: DAY, initialCategory: 'over25' }))).not.toContain('data-testid="member-ai"')
  })

  it('%100 ve geçmiş veri Az ise yüzde sönük, rozet belirgin; başka durumda değil', () => {
    expect(isOverstated({ percent: 100, reliability: 'low' })).toBe(true)
    for (const [percent, reliability] of [[100, 'high'], [100, 'medium'], [100, 'unknown'], [100, 'unmeasured'], [99, 'low'], [0, 'low']] as const) expect(isOverstated({ percent, reliability }), `${percent} ${reliability}`).toBe(false)

    // Verideki %100'lük maçta geçmiş veri "Çok": olağan görünüm.
    const normal = html(analysis(0, 'over25'))
    expect(normal).not.toContain('data-overstated="true"')
    expect(/class="([^"]*)" data-testid="member-percent">%100/.exec(normal)![1]).toContain('text-3xl')

    // Aynı maçta geçmiş veri "Az" olsaydı
    const low = JSON.parse(JSON.stringify(payload)) as MemberPayload
    low.days[0].lists[0].items[0].reliability = 'low'
    low.days[0].lists[0].items[0].sample = 4
    const markup = html(createElement(MemberAnalysis, { payload: low, today: DAY, initialCategory: 'over25' }))
    const card = markup.split('data-testid="member-card"')[1]
    expect(card.startsWith(' data-overstated="true"')).toBe(true)
    const percentClass = /class="([^"]*)" data-testid="member-percent">%100/.exec(card)![1]
    expect(percentClass).toContain('text-2xl')
    expect(percentClass).toContain('text-muted')
    expect(percentClass).not.toContain('text-brand')
    const badge = /<span class="([^"]*)" data-testid="member-reliability">([\s\S]*?)<\/span><\/span>|<span class="([^"]*)" data-testid="member-reliability">/.exec(card)!
    expect(badge[1] ?? badge[3]).toContain('font-extrabold')
    expect(badge[1] ?? badge[3]).toContain('border-2')
    expect(textOf(card)).toContain('⚠ Geçmiş veri: Az · en az 4 maç')
    // Yalnızca o kart etkilenir; yüzde ve sıra değişmez.
    expect(markup.split('data-overstated="true"').length - 1).toBe(1)
    expect(cards(markup)[0].startsWith('1 ')).toBe(true)
    expect(cards(markup)[0]).toContain('%100')
  })

  it('"Aynı maçın diğer önerileri": kategori adı ve o kategorideki yüzde; kendi kategorisi yok', () => {
    const day = payload.days[0]
    for (const list of day.lists.filter((l) => l.items.length > 0)) {
      const markup = html(analysis(0, list.categoryId))
      const drawn = markup.split(/data-testid="member-card"[^>]*>/).slice(1)
      list.items.forEach((item, i) => {
        const row = /data-testid="member-others">([\s\S]*?)<\/p>/.exec(drawn[i])
        if (item.others!.length === 0) return expect(row, `${list.categoryId} #${i + 1}`).toBeNull()
        const text = textOf(row![1]).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
        const expected = item.others!.map((o) => `${CATEGORIES.find((c) => c.id === o.categoryId)!.label} %${o.percent}${percentKind(o.categoryId) === 'model' ? ' (model)' : ''}`).join(' · ')
        expect(text).toBe(`Aynı maçın diğer önerileri: ${expected}`)
        // Kendi kategorisi satırda yer almaz.
        expect(item.others!.map((o) => o.categoryId)).not.toContain(list.categoryId)
      })
    }
    // Örnek: 2.5 ÜST kartında KG VAR ve İLK YARI 0.5 ÜST görünür; model tahminleri işaretlidir.
    const first = textOf(/data-testid="member-others">([\s\S]*?)<\/p>/.exec(html(analysis(0, 'over25')).split(/data-testid="member-card"[^>]*>/)[2])![1]).replace(/&nbsp;/g, ' ')
    expect(first).toMatch(/İLK YARI 0\.5 ÜST %91/)
    expect(first).toMatch(/KG VAR %89/)
    expect(first).toMatch(/KART 3\.5 ÜST %\d+ \(model\)/)
  })

  it('diğer önerisi olmayan maçta satır hiç çizilmez; sürüm 1 pakette de çizilmez', () => {
    const single = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: [makeMatch({ over25Pct: 90 }, { id: 'tek', date: DAY, home: 'Tek Ev', away: 'Tek Dep' })], results: [] }], picks: [], shared: [], leagueTables: [] }))
    expect(single.days[0].lists.find((l) => l.categoryId === 'over25')!.items[0].others).toEqual([])
    expect(html(createElement(MemberAnalysis, { payload: single, today: DAY }))).not.toContain('member-others')

    const v1 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v1 as { v: number }).v = 1
    for (const scope of ['all', 'shared'] as const) delete v1.statistics[scope].main
    for (const d of v1.days) for (const l of d.lists) for (const item of l.items) delete item.others
    const markup = html(createElement(MemberAnalysis, { payload: v1, today: DAY, initialCategory: 'over25' }))
    expect(markup).not.toContain('member-others')
    expect(markup.split('data-testid="member-card"').length - 1).toBe(v1.days[0].lists[0].items.length)
  })

  it('diğer önerilerde de %100 + Düşük sönük gösterilir; satır küçük ve soluktur', () => {
    const low = JSON.parse(JSON.stringify(payload)) as MemberPayload
    // "İç Anadolu FK" maçı 2.5 Üst'te %100: güvenilirliği her listede Düşük yapılır (şema tutarlılığı için ikisi birlikte).
    const day = low.days[0]
    const target = day.lists.find((l) => l.categoryId === 'over25')!.items.find((i) => i.percent === 100)!
    target.reliability = 'low'
    target.sample = 4
    for (const list of day.lists) for (const item of list.items) for (const other of item.others!) if (item.match === target.match && other.categoryId === 'over25') other.reliability = 'low'
    const markup = html(createElement(MemberAnalysis, { payload: low, today: DAY, initialCategory: 'ht05' }))
    const dimmed = [...markup.matchAll(/data-category="over25" data-overstated="true">([\s\S]*?)<\/span><\/span>|data-category="over25" data-overstated="true">([\s\S]*?)<\/span>/g)]
    expect(dimmed).toHaveLength(1)
    // Sönük yüzde vurgulanmaz; olağan yüzdeler yarı kalın ve beyazdır.
    expect(/data-category="over25" data-overstated="true">[\s\S]*?<span class="">%100<\/span>/.test(markup)).toBe(true)
    expect(/data-category="over25" data-overstated="false">[\s\S]*?<span class="font-semibold text-white">%88<\/span>/.test(markup)).toBe(true)
    expect(/class="([^"]*)" data-testid="member-others"/.exec(markup)![1]).toContain('text-[11px]')
    expect(/class="([^"]*)" data-testid="member-others"/.exec(markup)![1]).toContain('text-muted')
  })

  it('"Nasıl okunur?" kutusu kapalı gelir, açıklama cümlesinin altında ve kartların üstündedir', () => {
    const markup = html(analysis(0, 'over25'))
    expect(markup).toMatch(/<details[^>]*data-testid="member-howto"/)
    expect(/<details[^>]*data-testid="member-howto"[^>]*>/.exec(markup)![0]).not.toContain(' open')
    expect(textOf(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(markup)![0])).toBe(HOW_TO_READ_TITLE)
    expect(markup.indexOf('member-percent-note')).toBeLessThan(markup.indexOf('member-howto'))
    expect(markup.indexOf('member-howto')).toBeLessThan(markup.indexOf('member-cards'))
    const body = textOf(/data-testid="member-howto-body">([\s\S]*?)<\/details>/.exec(markup)![1])
    for (const item of HOW_TO_READ) {
      expect(body).toContain(item.title)
      for (const paragraph of item.paragraphs) expect(body).toContain(paragraph)
    }
    expect(HOW_TO_READ.map((i) => i.title)).toEqual(['Büyük yüzde', 'Yıldız', 'Geçmiş veri', 'AI öneri güveni', 'Çelişki rozetleri', 'Lig sırası ve oynanan maç', 'Aynı maçın diğer önerileri', 'Hiçbiri garanti değildir'])
  })

  it('"Nasıl okunur?" metni sabittir: paketten gelmez, eşik sayısı ve yasak terim içermez', () => {
    const all = HOW_TO_READ.flatMap((i) => [i.title, ...i.paragraphs]).join(' ')
    expect(JSON.stringify(payload)).not.toContain('Nasıl okunur')
    expect(all.toLocaleLowerCase('tr')).not.toMatch(/oran|piyasa|xg|csv|kaynak|footystats|bağlantı|odds|ortalama|https?:/)
    // Sayı olarak yalnızca yıldız ölçeği (1–5), örnek yüzde (%100), örnek maç sayısı ("en az 4 maç"),
    // liste adlarındaki çizgiler, "AI öneri güveni" özet örnekleri ("3/3 · Orta", "2/3 · Güçlü") ve "18+" geçer;
    // eşik sayıları (8, 16) geçmez.
    expect(all.replace(/1–5|%100|en az 4 maç|2\.5 Üst|3\/3 · Orta|2\/3 · Güçlü|18\+/g, '').match(/\d/g)).toBeNull()
    // Etiketin ne OLMADIĞI açıkça yazılıdır.
    const data = HOW_TO_READ.find((i) => i.title === 'Geçmiş veri')!.paragraphs.join(' ')
    expect(data).toContain('maçın sonucuna duyulan güveni DEĞİL, yalnızca eldeki veri miktarını anlatır')
    expect(data).toContain('küçük bir örneğe dayanır')
    expect(data).toContain('Gerçekteki maç sayısı daha fazla olabilir; bu yüzden “en az” yazar')
    expect(all).not.toMatch(/Güvenilirlik|güvenilirlik/)
    // Anlatılan etiketler sayfadaki gerçek etiketlerle aynıdır.
    for (const label of [PERCENT_LABELS.history, PERCENT_LABELS.model, 'Model çelişkisi', 'Hesaplar çelişiyor', 'Model tabanlı', 'Ölçülemedi', 'Bilinmiyor', 'İkinci hesap', '⚠ tablo eski']) expect(all).toContain(label)
  })

  it('önerisi olmayan gün boş durum gösterir', () => {
    const empty = buildMemberPayload(memberInput({ days: [{ date: '2026-10-09', matches: [], results: [] }] }))
    expect(textOf(html(createElement(MemberAnalysis, { payload: empty, today: DAY })))).toContain('Bu gün için yayınlanmış öneri yok.')
  })
})

describe('istatistik sayfası', () => {
  const stats = (initialScope: 'all' | 'shared' = 'all', initialPeriod: 'daily' | 'weekly' | 'monthly' = 'daily') =>
    html(createElement(MemberStatsPage, { payload, initialScope, initialPeriod }), '/uye/istatistik')

  it('değerler paketteki önceden hesaplanmış değerlerdir (Tümü ve Paylaşılan)', () => {
    for (const scope of ['all', 'shared'] as const) {
      const s = payload.statistics[scope]
      const text = textOf(stats(scope))
      const main = s.main!
      // En üstteki kart ana kategorileri, altındaki soluk satır tüm kategorileri gösterir.
      expect(text).toContain('ANA KATEGORİLER BAŞARISI')
      expect(text).toContain('2.5 ÜST · KG VAR · İLK YARI 0.5 ÜST')
      expect(text).not.toContain('GENEL BAŞARI')
      expect(text).toContain(`· ${main.overall.decided} öneri · ${main.matches.decided} benzersiz maç`)
      expect(text).toContain(`Tuttu ${main.overall.won} Tutmadı ${main.overall.lost} Değerlendirilemedi`)
      expect(text).toContain(`Tüm kategoriler: ${formatRate(s.overall.rate)} · ${s.overall.decided} öneri · ${s.matches.decided} benzersiz maç`)
      for (const bucket of s.byCategory) expect(text).toContain(CATEGORIES.find((c) => c.id === bucket.key)!.label)
    }
    // Sayfa hesap yapmaz: gösterilen başarı, paketteki değerin biçimlendirilmiş hâlidir.
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('all'))![1]).toBe(formatRate(payload.statistics.all.main!.overall.rate))
    expect(payload.statistics.all.main!.overall.rate).not.toBe(payload.statistics.all.overall.rate)
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('shared'))![1]).toBe('%50')
  })

  it('eski paket (ana kategoriler alanı olmayan) eski "GENEL BAŞARI" kartıyla açılır', () => {
    const old = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(old as { v: number }).v = 2
    for (const scope of ['all', 'shared'] as const) delete old.statistics[scope].main
    const markup = html(createElement(MemberStatsPage, { payload: old }), '/uye/istatistik')
    const text = textOf(markup)
    expect(text).toContain('GENEL BAŞARI')
    expect(text).not.toContain('ANA KATEGORİLER')
    expect(text).not.toContain('Tüm kategoriler:')
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(markup)![1]).toBe(formatRate(old.statistics.all.overall.rate))
    expect(text).toContain(`· ${old.statistics.all.overall.decided} öneri · ${old.statistics.all.matches.decided} benzersiz maç`)
  })

  it('Tümü / Paylaşılan geçişi ve dönem seçimi çizilir', () => {
    const all = stats('all')
    expect(/aria-pressed="true"[^>]*data-testid="member-scope-all"/.test(all)).toBe(true)
    expect(/aria-pressed="false"[^>]*data-testid="member-scope-shared"/.test(all)).toBe(true)
    expect(/aria-pressed="true"[^>]*data-testid="member-scope-shared"/.test(stats('shared'))).toBe(true)
    expect(textOf(stats('all', 'daily'))).toContain('5 Eki 2026')
    expect(textOf(stats('all', 'weekly'))).toContain('5 Eki – 11 Eki 2026')
    expect(textOf(stats('all', 'monthly'))).toContain('Ekim 2026')
  })

  it('geçmiş veri satırları üye etiketleriyle; az veride uyarı; öneri yoksa boş durum', () => {
    const text = textOf(stats('shared'))
    expect(textOf(stats('all'))).toContain('GEÇMİŞ VERİ MİKTARINA GÖRE BAŞARI')
    expect(textOf(stats('all'))).not.toMatch(/GÜVENİLİRLİ|güvenilirlik/)
    expect(text).toContain('⚠ az veri')
    expect(textOf(stats('all'))).toContain('Model tabanlı')
    const empty = buildMemberPayload(memberInput({ picks: [], shared: [] }))
    expect(textOf(html(createElement(MemberStatsPage, { payload: empty })))).toContain('Bu ölçüde henüz sonuçlanan öneri yok.')
  })

  it('kalibrasyon, piyasa, yapay zekâ ve skor deneyi kartları yoktur', () => {
    const text = textOf(stats('all')).toLocaleUpperCase('tr')
    for (const word of ['KALİBRASYON', 'YAPAY ZEKÂ', 'SKOR TAHMİN', 'GÜNLÜK GÖRSEL', 'ANALİZ İÇİN ÖZET']) expect(text).not.toContain(word)
  })
})

describe('SIZINTI: çizilen sayfada yasak terim yok', () => {
  const FORBIDDEN = /oran|piyasa|xg|csv|kaynak|footystats|bağlantı|https?:|www\.|odds|ortalama/
  /** Görünen metin ve kullanıcıya okunan öznitelikler (ipucu, erişilebilirlik adı, yer tutucu) */
  const visible = (markup: string): string =>
    [textOf(markup), ...[...markup.matchAll(/\s(?:title|aria-label|alt|placeholder|value)="([^"]*)"/g)].map((m) => m[1])].join(' ').toLocaleLowerCase('tr')

  const pages: [string, string][] = [
    ...(['credentials', 'network', 'missing', 'invalid', 'outdated', 'corrupt', 'unsupported'] as const).map(
      (error): [string, string] => [`giriş (${error})`, html(createElement(MemberLogin, { busy: false, error, notice: null, onLogin: noop }))],
    ),
    ['giriş (meşgul)', html(createElement(MemberLogin, { busy: true, error: null, notice: 'expired', onLogin: noop }))],
    ['giriş (erişim kalkmış)', html(createElement(MemberLogin, { busy: false, error: null, notice: 'revoked', onLogin: noop }))],
    ...payload.days.flatMap((day, d) =>
      day.lists.filter((l) => l.items.length > 0).map((l): [string, string] => [`${day.date} ${l.categoryId}`, shell(analysis(d, l.categoryId), Date.parse(PUBLISHED_AT) + 20 * HOUR, 'network')]),
    ),
    ...(['all', 'shared'] as const).flatMap((scope) =>
      (['daily', 'weekly', 'monthly'] as const).map((period): [string, string] => [`istatistik ${scope} ${period}`, shell(createElement(MemberStatsPage, { payload, initialScope: scope, initialPeriod: period }))]),
    ),
  ]

  it('denetlenen sayfalar: giriş, her günün her dolu kategorisi, istatistiğin her görünümü', () => {
    expect(pages.length).toBeGreaterThan(30)
    expect(pages.map(([name]) => name)).toContain(`${DAY} awayWin15`)
  })

  it.each(pages)('%s', (_, markup) => {
    const text = visible(markup)
    expect(text.length).toBeGreaterThan(100)
    expect(FORBIDDEN.exec(text)?.[0] ?? null).toBeNull()
    // Ham veriden hiçbir ipucu (title) taşınmaz: yalnızca yıldızların erişilebilirlik adı vardır.
    expect(markup).not.toMatch(/\stitle="/)
  })

  it('denetim boş değil: yasak terim içeren bir metin yakalanır', () => {
    for (const leak of ['Kaynak: CSV', 'Piyasa %64', 'xG 1,9 – 1,2', 'Gol ortalaması 3,4', 'başarı oranı', 'https://footystats.org/x']) expect(FORBIDDEN.test(leak.toLocaleLowerCase('tr')), leak).toBe(true)
  })
})

describe('günün öne çıkanları kutusu', () => {
  const box = (markup: string): string | null => /<section[^>]*data-testid="member-highlights"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? null
  const rowsOf = (markup: string) => markup.split(/data-testid="member-highlight"[^>]*>/).slice(1).map((part) => textOf(part.split('</li>')[0]))
  const today = box(html(analysis(0)))!

  it('seçim sayısı kadar satır: saat, maç, kategori; skor ve sonuç', () => {
    expect(today).not.toBeNull()
    const rows = rowsOf(today)
    expect(rows).toHaveLength(dayHighlights(DAY).length)
    const kuzey = rows.find((r) => r.includes('Kuzey Yıldızı') && r.includes('2.5 ÜST'))!
    expect(kuzey).toMatch(/^\d{2}:\d{2} Kuzey Yıldızı – Güney Spor 2\.5 ÜST/)
    expect(kuzey).toContain('İY 1-0 · MS 3-1')
    expect(kuzey).toContain('✓ Tuttu')
    expect(rows.find((r) => r.includes('Doğu Gençlik'))).toContain('✗ Tutmadı')
    const pending = rows.find((r) => r.includes('İç Anadolu FK'))!
    expect(pending).toContain('··· Bekliyor')
    expect(pending).not.toMatch(/MS \d/)
    // Satırlar saat sırasındadır.
    expect(rows.map((r) => r.slice(0, 5))).toEqual([...rows.map((r) => r.slice(0, 5))].sort())
  })

  it('başlıkta küçük "deneme" notu ve altta yasal not; yüzde ve güvenilirlik yazmaz', () => {
    const text = textOf(today)
    expect(text).toContain(`${MEMBER_HIGHLIGHT_TEXTS.title} ${MEMBER_HIGHLIGHT_TEXTS.trial}`)
    expect(MEMBER_HIGHLIGHT_TEXTS.trial).toBe('deneme')
    expect(text).toContain('Bu bir istatistik taramasıdır; bahis tavsiyesi değildir.')
    expect(text).toContain(`${dayHighlights(DAY).length} seçim`)
    expect(text).not.toContain('%')
    expect(text).not.toContain(String(HIGHLIGHT_PERCENT))
    expect(text.toLocaleLowerCase('tr')).not.toMatch(/güvenilirlik|oran|tutar|kupon|oyna/)
    expect(text).not.toMatch(/[★☆]/)
  })

  it('kutu, seçili günün seçimlerini gösterir; gün başlığının altında, kategori düğmelerinin üstündedir', () => {
    const markup = html(analysis(0))
    expect(markup.indexOf('member-day-title')).toBeLessThan(markup.indexOf('member-highlights'))
    expect(markup.indexOf('member-highlights')).toBeLessThan(markup.indexOf('member-category-'))
    const previous = rowsOf(box(html(analysis(1)))!)
    expect(previous).toHaveLength(1)
    expect(previous[0]).toContain('Dünkü Ev – Dünkü Deplasman')
    expect(previous[0]).toContain('KG VAR')
  })

  it('seçim yoksa kutu hiç çizilmez: boş dizi, sürüm 3 paket ve önerisi olmayan gün', () => {
    const none = buildMemberPayload(memberInput({ days: memberInput().days.map(({ date, matches, results }) => ({ date, matches, results })) }))
    expect(html(createElement(MemberAnalysis, { payload: none, today: DAY }))).not.toContain('member-highlights')
    const v3 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v3 as { v: number }).v = 3
    for (const day of v3.days) delete day.highlights
    expect(html(createElement(MemberAnalysis, { payload: v3, today: DAY }))).not.toContain('member-highlights')
  })

  it('önerisi olmayan ama öne çıkanı olan günde kutu görünür, altında "öneri yok" yazar', () => {
    const input = memberInput()
    const only = buildMemberPayload({ ...input, days: [{ ...input.days[0], matches: [], results: input.days[0].results }] })
    const markup = html(createElement(MemberAnalysis, { payload: only, today: DAY }))
    expect(rowsOf(box(markup)!)).toHaveLength(dayHighlights(DAY).length)
    expect(textOf(markup)).toContain('Bu gün için yayınlanmış öneri yok.')
    // Maç verisi yok: adlar kayıttan, sonuç dondurulmuş öneriden.
    expect(rowsOf(box(markup)!).find((r) => r.includes('Kuzey Yıldızı') && r.includes('2.5 ÜST'))).toContain('✓ Tuttu')
  })
})

describe('geçmiş veri rozeti ve tahmini maç sayısı', () => {
  const badges = (markup: string) => [...markup.matchAll(/data-testid="member-reliability">([\s\S]*?)<\/span>(?=<span class="[^"]*" data-testid="member-conflict"|<\/div>)/g)].map((m) => textOf(m[1]))
  const over25 = payload.days[0].lists.find((l) => l.categoryId === 'over25')!

  it('seviyenin yanında "en az N maç": paketteki sayı aynen yazılır', () => {
    const drawn = badges(html(analysis(0, 'over25')))
    expect(drawn).toHaveLength(over25.items.length)
    const LABEL = { low: 'Az', medium: 'Orta', high: 'Çok' } as const
    over25.items.forEach((item, i) => {
      if (item.sample === undefined) expect(drawn[i]).not.toContain('en az')
      else expect(drawn[i]).toBe(`Geçmiş veri: ${LABEL[item.reliability as keyof typeof LABEL]} · en az ${item.sample} maç`)
    })
    expect(over25.items.some((item) => item.sample !== undefined)).toBe(true)
  })

  it('sayı olmayan pakette (sürüm 3 ve 4) yalnızca seviye görünür', () => {
    for (const version of [3, 4]) {
      const old = JSON.parse(JSON.stringify(payload)) as MemberPayload
      ;(old as { v: number }).v = version
      for (const day of old.days) {
        if (version === 3) delete day.highlights
        for (const list of day.lists) for (const item of list.items) delete item.sample
      }
      const drawn = badges(html(createElement(MemberAnalysis, { payload: old, today: DAY, initialCategory: 'over25' })))
      expect(drawn).toHaveLength(over25.items.length)
      for (const text of drawn) expect(text).toMatch(/^Geçmiş veri: (Az|Orta|Çok|Bilinmiyor)$/)
    }
  })

  it('"Bilinmiyor" ve "Ölçülemedi" seviyelerinde sayı yazmaz; "Model tabanlı" aynıdır', () => {
    const unknown = JSON.parse(JSON.stringify(payload)) as MemberPayload
    const first = unknown.days[0].lists.find((l) => l.categoryId === 'over25')!.items[0]
    first.reliability = 'unknown'
    delete first.sample
    expect(badges(html(createElement(MemberAnalysis, { payload: unknown, today: DAY, initialCategory: 'over25' })))[0]).toBe('Geçmiş veri: Bilinmiyor')
    for (const text of badges(html(analysis(0, 'corners85')))) expect(text).toBe('Geçmiş veri: Ölçülemedi')
    for (const text of badges(html(analysis(0, 'homeWin15')))) expect(text).toMatch(/^(Model tabanlı( \(kısmi\))?|Geçmiş veri: .+)$/)
  })
})
