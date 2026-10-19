import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../config/categories'
import { MAIN_CATEGORY_IDS, MAIN_SCOPE_NOTE } from '../config/mainCategories'
import { DEFAULT_MEMBER_TEXTS } from '../config/memberTexts'
import { MEMBER_STALE_HOURS } from '../config/member'
import { DAY, dayHighlights, HIGHLIGHT_PERCENT, memberInput, PREVIOUS_DAY, PUBLISHED_AT } from '../services/member/__fixtures__/rawData'
import type { MemberErrorKind } from '../services/member/controller'
import { MEMBER_ERROR_TEXTS, MEMBER_HIGHLIGHT_TEXTS, MEMBER_MARKET_LABEL, MEMBER_MARKET_NOTE, MEMBER_MARKET_NOTE_BUTTON, MEMBER_HT_SCORELESS_TEXT, MEMBER_NOTICE_TEXTS, MEMBER_STREAK_TEXTS, STALE_DATA_TEXT } from '../services/member/labels'
import { buildMemberPayload } from '../services/member/payload'
import { assertMemberPayload } from '../services/member/schema'
import { formatRate } from '../utils/format'
import { HOW_TO_READ, HOW_TO_READ_TITLE } from './howToRead'
import MemberAnalysis from './MemberAnalysis'
import MemberLogin from './MemberLogin'
import { LEGAL_NOTICE } from './legalNotice'
import MemberShell from './MemberShell'
import MemberStatsPage from './MemberStatsPage'
import MemberStreak from './MemberStreak'
import { CALCULATORS } from '../services/analysis/calculators'
import { makeMatch } from '../services/analysis/testUtils'
import type { MemberPayload } from '../services/member/payload'
import { streakMeanText, categoryChoices, dayChip, dayTitle, isOverstated, isStale, listFor, orderItems, OTHER_COMPUTED_TAG, PERCENT_LABELS, PERCENT_NOTE, percentKind, secondPercentLabel, SORT_ANNOUNCE, SORT_GROUP_LABEL, SORT_LABELS, TIME_SORT_NOTE, updatedText } from './view'

/** Sürüm 11'den eski paket: önerilerde piyasa yüzdesi (mkt) alanı yoktur */
const withoutMkt = (p: MemberPayload): void => {
  for (const d of p.days) for (const l of d.lists) for (const i of l.items) delete i.mkt
}

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
/**
 * Piyasa yüzdesinin onaylı metinleri birebir çıkarılır: kart etiketi ("Piyasa %54"), "Nasıl okunur?" başlığı
 * (etiketin kendisi) ve not. Başka yerde geçen "piyasa" yine yakalanır (derleme denetimindeki istisnanın karşılığı).
 */
const withoutMarketText = (markup: string): string =>
  markup
    .split(MEMBER_MARKET_NOTE)
    .join(' ')
    .split(`>${MEMBER_MARKET_LABEL}</h3>`)
    .join('></h3>')
    .replace(new RegExp(`(^|>|\\s)${MEMBER_MARKET_LABEL}(\\s|<[^>]*>)*%\\d{1,3}(?!\\d)`, 'g'), '$1')

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
    expect(links(at('', '/'))).toEqual(['/', '/istatistik', '/seri'])
    expect(links(at('/uye', '/uye'))).toEqual(['/uye', '/uye/istatistik', '/uye/seri'])
    expect(links(at(undefined, '/uye'))).toEqual(['/uye', '/uye/istatistik', '/uye/seri'])
    // Etkin sekme doğru işaretlenir.
    expect(/<a [^>]*aria-current="page"[^>]*href="\/"|<a [^>]*href="\/"[^>]*aria-current="page"/.test(at('', '/'))).toBe(true)
    expect(/href="\/istatistik"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/istatistik"/.test(at('', '/istatistik'))).toBe(true)
  })

  it('yalnızca üç sekme ve Çıkış vardır; admin gezinmesi yoktur', () => {
    const markup = shell(analysis())
    expect([...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/uye', '/uye/istatistik', '/uye/seri'])
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
    expect(done).toContain('Ev 1. sıra · 8 maç')
    expect(done).toContain('Dep 4. sıra · 7 maç')
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
    // doğrudan kullanan kategoriler "geçmiş sıklık", gerisi "hesaplanan tahmin"dir.
    for (const category of CATEGORIES) expect(percentKind(category.id), category.id).toBe(CALCULATORS[category.id].basis.startsWith('CSV:') ? 'history' : 'model')
    expect(PERCENT_LABELS).toEqual({ history: 'Geçmiş maçlarda görülme sıklığı', model: 'Hesaplanan tahmin' })
    const label = (categoryId: (typeof CATEGORIES)[number]['id']) => /data-testid="member-percent-label">([^<]*)/.exec(html(analysis(0, categoryId)))![1]
    for (const id of ['over25', 'ht05', 'btts', 'sh05', 'over35', 'ht15', 'corners85'] as const) expect(label(id), id).toBe('Geçmiş maçlarda görülme sıklığı')
    for (const id of ['over25btts', 'cards35', 'homeWin15', 'awayWin15'] as const) expect(label(id), id).toBe('Hesaplanan tahmin')
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

  it('"AI öneri güveni" satırı yalnızca kendi kategorisinin kartında görünür; başlık kategoriyi taşır; skor tahmini, gerekçe ve risk yoktur', () => {
    const card = (categoryId: (typeof CATEGORIES)[number]['id'], home: string) => cards(html(analysis(0, categoryId))).find((c) => c.includes(home))!
    // Örnek maç: 2.5 ÜST 3/3 Orta · KG VAR 2 Orta + 1 Zayıf · İLK YARI 0.5 ÜST 2 Zayıf + 1 Orta
    expect(card('over25', 'Kuzey Yıldızı')).toContain('AI öneri güveni (2.5 Üst): ChatGPT: Orta Gemini: Orta Claude: Orta 3/3 · Orta')
    expect(card('btts', 'Kuzey Yıldızı')).toContain('AI öneri güveni (KG Var): ChatGPT: Orta Gemini: Orta Claude: Zayıf 2/3 · Orta')
    expect(card('ht05', 'Kuzey Yıldızı')).not.toContain('AI öneri güveni')
    // Aynı maçın 2.5 ÜST kararı KG VAR kartında, KG VAR kararı 2.5 ÜST kartında görünmez.
    expect(card('btts', 'Kuzey Yıldızı')).not.toContain('(2.5 Üst)')
    expect(card('over25', 'Kuzey Yıldızı')).not.toContain('(KG Var)')
    // 2 Güçlü + 1 Eleme: o kategoride yok, diğer kategori etkilenmez.
    expect(card('over25', 'Doğu Gençlik')).not.toContain('AI öneri güveni')
    expect(card('btts', 'Doğu Gençlik')).toContain('AI öneri güveni (KG Var): ChatGPT: Güçlü Gemini: Güçlü Claude: Güçlü 3/3 · Güçlü')
    // Bir yapay zekâ kategoriyi atladı: o kategoride yok, cevapladığında var.
    expect(card('over25', 'İç Anadolu FK')).not.toContain('AI öneri güveni')
    expect(card('ht05', 'İç Anadolu FK')).toContain('AI öneri güveni (İlk Yarı 0.5 Üst): ChatGPT: Orta Gemini: Orta Claude: Orta 3/3 · Orta')
    // Karar istenmeyen listelerin (2. yarı, korner, kart, Taraf & Gol…) kartlarında satır hiç yok; maç orada duruyor.
    const others = payload.days[0].lists.filter((l) => l.items.length > 0 && !['over25', 'ht05', 'btts', 'over25btts'].includes(l.categoryId))
    expect(others.length).toBeGreaterThan(5)
    for (const list of others) expect(html(analysis(0, list.categoryId)), list.categoryId).not.toContain('data-testid="member-ai"')
    expect(cards(html(analysis(0, 'sh05'))).some((c) => c.includes('Kuzey Yıldızı'))).toBe(true)
    const markup = html(analysis(0, 'over25'))
    expect(markup).not.toMatch(/Eleme|Skor olasılıkları|kanarya|Risk/)
    // "Geçmiş veri" etiketi satır çıksa da yerinde durur.
    expect(card('over25', 'Kuzey Yıldızı')).toContain('Geçmiş veri:')
    expect(markup.split('data-testid="member-reliability"').length).toBe(markup.split('data-testid="member-card"').length)
  })

  it('sürüm 6 paketteki maç geneli satır gösterilmez; paket yine açılır', () => {
    const v6 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v6 as { v: number }).v = 6
    withoutMkt(v6)
    delete v6.streak
    for (const d of v6.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v6.statistics[scope].htScoreless
    const row = v6.days[0].lists.find((l) => l.categoryId === 'over25')!.items.find((i) => i.ai)!.ai!
    for (const d of v6.days) for (const l of d.lists) for (const i of l.items) delete i.ai
    for (const m of v6.days[0].matches) m.ai = row
    expect(() => assertMemberPayload(v6)).not.toThrow()
    for (const id of ['over25', 'btts', 'sh05'] as const) {
      const markup = html(createElement(MemberAnalysis, { payload: v6, today: DAY, initialCategory: id }))
      expect(markup).toContain('data-testid="member-card"')
      expect(markup).not.toContain('data-testid="member-ai"')
    }
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
        const expected = item.others!.map((o) => `${CATEGORIES.find((c) => c.id === o.categoryId)!.label} %${o.percent}${percentKind(o.categoryId) === 'model' ? ' (hesaplanan)' : ''}`).join(' · ')
        expect(text).toBe(`Aynı maçın diğer önerileri: ${expected}`)
        // Kendi kategorisi satırda yer almaz.
        expect(item.others!.map((o) => o.categoryId)).not.toContain(list.categoryId)
      })
    }
    // Örnek: 2.5 ÜST kartında KG VAR ve İLK YARI 0.5 ÜST görünür; hesaplanan tahminler işaretlidir.
    const first = textOf(/data-testid="member-others">([\s\S]*?)<\/p>/.exec(html(analysis(0, 'over25')).split(/data-testid="member-card"[^>]*>/)[2])![1]).replace(/&nbsp;/g, ' ')
    expect(first).toMatch(/İLK YARI 0\.5 ÜST %91/)
    expect(first).toMatch(/KG VAR %89/)
    expect(first).toMatch(/KART 3\.5 ÜST %\d+ \(hesaplanan\)/)
  })

  it('"(hesaplanan)" işareti kategoriye göre çıkar: yüzdesi hesap olanlarda var, geçmiş sıklık olanlarda yok; "model" sözcüğü kullanılmaz', () => {
    expect(OTHER_COMPUTED_TAG).toBe('(hesaplanan)')
    const computed = ['over25btts', 'cards35', 'cards45', 'homeWin15', 'homeWin25', 'awayWin15', 'awayWin25']
    // İşaret alan kategoriler tam olarak bunlardır; gol, yarı ve korner listeleri almaz.
    expect(CATEGORIES.filter((c) => percentKind(c.id) === 'model').map((c) => c.id).sort()).toEqual([...computed].sort())
    const seen = new Map<string, boolean>()
    const day = payload.days[0]
    for (const list of day.lists.filter((l) => l.items.length > 0)) {
      const markup = html(analysis(0, list.categoryId))
      for (const [, categoryId, inner] of markup.matchAll(/data-testid="member-other" data-category="([^"]+)"[^>]*>([\s\S]*?)<\/span>(?=<span key|<span class="inline-block|<\/p>)/g)) {
        const tagged = textOf(inner).includes('(hesaplanan)')
        expect(tagged, categoryId).toBe(computed.includes(categoryId))
        seen.set(categoryId, tagged)
      }
      // Satırda eski "(model)" işareti kalmadı.
      for (const [, row] of markup.matchAll(/data-testid="member-others">([\s\S]*?)<\/p>/g)) expect(textOf(row)).not.toContain('(model)')
      expect(markup).not.toContain('Model tahmini')
    }
    // Deney iki türü de kapsıyor: hesaplanan (kart, 2.5 Üst & KG Var, Taraf & Gol) ve geçmiş sıklık (gol, yarı, korner).
    for (const id of ['cards35', 'over25btts', 'homeWin15']) expect(seen.get(id), id).toBe(true)
    for (const id of ['over25', 'btts', 'ht05', 'corners85']) expect(seen.get(id), id).toBe(false)
  })

  it('kartın sağ üstündeki ikinci yüzdenin etiketi aynen "Model" kalır; büyük yüzdenin etiketi "Hesaplanan tahmin" olur', () => {
    expect(secondPercentLabel('over25')).toBe('Model')
    expect(secondPercentLabel('homeWin15')).toBe('İkinci hesap')
    expect(html(analysis(0, 'over25'))).toMatch(/Model <span[^>]*>%\d+/)
    expect(textOf(html(analysis(0, 'cards35')))).toContain('Hesaplanan tahmin')
    const help = HOW_TO_READ.flatMap((i) => i.paragraphs).join(' ')
    expect(help).toContain('“Hesaplanan tahmin”')
    expect(help).toContain('Yanında “(hesaplanan)” yazanlar geçmişte kaç kez görüldüğüne değil, bir hesaba dayanır')
    expect(help).not.toContain('(model)')
    expect(help).not.toContain('Model tahmini')
    // İkinci yüzdenin açıklaması duruyor.
    expect(help).toContain('“Model” ya da “İkinci hesap” adıyla ikinci bir yüzde')
  })

  it('diğer önerisi olmayan maçta satır hiç çizilmez; sürüm 1 pakette de çizilmez', () => {
    const single = buildMemberPayload(memberInput({ days: [{ date: DAY, matches: [makeMatch({ over25Pct: 90 }, { id: 'tek', date: DAY, home: 'Tek Ev', away: 'Tek Dep' })], results: [] }], picks: [], shared: [], leagueTables: [] }))
    expect(single.days[0].lists.find((l) => l.categoryId === 'over25')!.items[0].others).toEqual([])
    expect(html(createElement(MemberAnalysis, { payload: single, today: DAY }))).not.toContain('member-others')

    const v1 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v1 as { v: number }).v = 1
    withoutMkt(v1)
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
    expect(HOW_TO_READ.map((i) => i.title)).toEqual(['Büyük yüzde', MEMBER_MARKET_LABEL, 'Yıldız', 'Geçmiş veri', 'AI öneri güveni', 'Çelişki rozetleri', 'Lig sırası ve oynanan maç', 'Aynı maçın diğer önerileri', 'Hiçbiri garanti değildir'])
  })

  it('"Nasıl okunur?" metni sabittir: paketten gelmez, eşik sayısı ve yasak terim içermez', () => {
    // Piyasa maddesi yalnızca onaylı iki metindir (kartın etiketi ve notu); taramaya girmez.
    expect(HOW_TO_READ.find((i) => i.title === MEMBER_MARKET_LABEL)!.paragraphs).toEqual([MEMBER_MARKET_NOTE])
    const all = HOW_TO_READ.flatMap((i) => [i.title, ...i.paragraphs])
      .filter((t) => t !== MEMBER_MARKET_LABEL && t !== MEMBER_MARKET_NOTE)
      .join(' ')
    expect(JSON.stringify(payload)).not.toContain('Nasıl okunur')
    expect(all.toLocaleLowerCase('tr')).not.toMatch(/oran|piyasa|xg|csv|kaynak|footystats|bağlantı|odds|ortalama|https?:/)
    // Sayı olarak yalnızca yıldız ölçeği (1–5), örnek yüzde (%100), örnek maç sayısı ("en az 4 maç"),
    // liste adları ("2.5 Üst", "İlk Yarı 0.5 Üst"), "AI öneri güveni" özet örnekleri ("3/3 · Orta", "2/3 · Güçlü"), karttaki satır adı ("Son 5 maç") ve "18+" geçer;
    // eşik sayıları (8, 16) geçmez.
    expect(all.replace(/1–5|%100|en az 4 maç|2\.5 Üst|0\.5 Üst|3\/3 · Orta|2\/3 · Güçlü|18\+|Son 5 maç/g, '').match(/\d/g)).toBeNull()
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
      // En üstteki kart ana kategorileri gösterir; tüm kategorilerin toplamı yazılmaz (yalnızca kategori dökümü).
      expect(text).toContain(MAIN_SCOPE_NOTE.replaceAll("'", '&#x27;'))
      expect(text).toContain('ANA KATEGORİLER BAŞARISI')
      expect(text).toContain('2.5 ÜST · KG VAR · İLK YARI 0.5 ÜST')
      expect(text).not.toContain('GENEL BAŞARI')
      expect(text).toContain(`· ${main.overall.decided} öneri · ${main.matches.decided} benzersiz maç`)
      expect(text).toContain(`Tuttu ${main.overall.won} Tutmadı ${main.overall.lost} Değerlendirilemedi`)
      expect(text).not.toContain('Tüm kategoriler:')
      expect(stats(scope)).not.toContain('member-all-line')
      for (const bucket of s.byCategory) expect(text).toContain(CATEGORIES.find((c) => c.id === bucket.key)!.label)
    }
    // Sayfa hesap yapmaz: gösterilen başarı, paketteki değerin biçimlendirilmiş hâlidir.
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('all'))![1]).toBe(formatRate(payload.statistics.all.main!.overall.rate))
    expect(payload.statistics.all.overall).toEqual(payload.statistics.all.main!.overall)
    expect(payload.statistics.all.byCategory.some((b) => !(MAIN_CATEGORY_IDS as readonly string[]).includes(b.key))).toBe(true)
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('shared'))![1]).toBe('%50')
  })

  it('eski paket (ana kategoriler alanı olmayan) eski "GENEL BAŞARI" kartıyla açılır', () => {
    const old = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(old as { v: number }).v = 2
    withoutMkt(old)
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
    // Ana kategorilerde "Model tabanlı" / "Ölçülemedi" seviyesi yok: boş satır çizilmez.
    expect(textOf(stats('all'))).not.toMatch(/Model tabanlı|Ölçülemedi/)
    expect(payload.statistics.all.byReliability.every((b) => b.tally.decided > 0)).toBe(true)
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
    [textOf(withoutMarketText(markup)), ...[...markup.matchAll(/\s(?:title|aria-label|alt|placeholder|value)="([^"]*)"/g)].map((m) => m[1])].join(' ').toLocaleLowerCase('tr')

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
    withoutMkt(v3)
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
      withoutMkt(old)
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

describe('seri takibi sayfası', () => {
  const streak = payload.streak!
  const page = html(createElement(MemberStreak, { streak }))
  const text = textOf(page)
  const block = (testId: string) => page.slice(page.indexOf(`data-testid="${testId}"`))

  it('başlıkta "deneme" notu, altta yasal not', () => {
    expect(text).toContain('Seri Takibi deneme')
    expect(page).toContain('data-testid="member-streak-trial"')
    expect(textOf(block('member-streak-note'))).toContain('İstatistik takibidir, bahis tavsiyesi değildir. 18+')
  })

  it('sayılar paketten olduğu gibi gösterilir; az örnek uyarısı çıkar', () => {
    const totals = textOf(block('member-streak-totals').split('data-testid="member-streak-active"')[0])
    expect(totals).toContain('En uzun seri 1')
    expect(totals).toContain('Mevcut seri 1')
    expect(totals).toContain('Toplam seri 1')
    expect(totals).toContain('Seri başına tutan (ort.) 1,0')
    expect(totals).toContain('Tuttu 2')
    expect(totals).toContain('Tutmadı 1')
    expect(totals).toContain('⚠ az örnek')
    expect(streakMeanText(null)).toBe('—')
    expect(streakMeanText(2.5)).toBe('2,5')
    const enough = { ...streak, totals: { ...streak.totals, lowSample: false } }
    expect(html(createElement(MemberStreak, { streak: enough }))).not.toContain('member-streak-low-sample')
  })

  it('aktif seri: maç, kategori, gün ve saat, adım numarası ve durum; kaldırılan adımın numarası yok', () => {
    const rows = block('member-streak-active').split('data-testid="member-streak-past"')[0].split('data-testid="member-streak-step"').slice(1).map(textOf)
    expect(rows.length).toBe(3)
    expect(rows[0]).toMatch(/Kuzey Yıldızı – Güney Spor 2\.5 ÜST · 5 Eki 2026 \d{2}:\d{2}/)
    expect(rows[0]).toContain('1. adım')
    expect(rows[0]).toContain('✓ Tuttu')
    expect(rows[1]).toContain('— Oynanmadı')
    expect(rows[1]).not.toContain('adım')
    expect(rows[2]).toContain('2. adım')
    expect(rows[2]).toContain('··· Bekliyor')
  })

  it('geçmiş seriler: uzunluk, bitiş günü ve seriyi bitiren maç', () => {
    const past = textOf(block('member-streak-past').split('data-testid="member-streak-note"')[0])
    expect(past).toContain('GEÇMİŞ SERİLER 1')
    expect(past).toContain('1 adım tuttu')
    expect(past).toContain('5 Eki 2026')
    expect(past).toContain('Seriyi bitiren maç: Doğu Gençlik –')
  })

  it('yüzde, yıldız, skor ve yasak sözcükler yazmaz', () => {
    expect(text).not.toContain('%')
    expect(text).not.toMatch(/[★☆]/)
    expect(text).not.toMatch(/(İY|MS) \d/)
    expect(text.replace(MEMBER_STREAK_TEXTS.note, '').toLocaleLowerCase('tr')).not.toMatch(/güvenilirlik|oran|tutar|kupon|kasa|bahis|katla|rolling|kazanç|ortalama/)
  })

  it('boş seri: "Henüz seri yok"; biten seri varken aktif seri yoksa ayrı metin', () => {
    const none = buildMemberPayload(memberInput({ streak: undefined })).streak!
    const empty = textOf(html(createElement(MemberStreak, { streak: none })))
    expect(empty).toContain('Henüz seri yok.')
    expect(empty).toContain('Seri başına tutan (ort.) —')
    const idle = { ...streak, status: 'idle' as const, steps: [], totals: { ...streak.totals, current: 0, won: 1 } }
    expect(textOf(html(createElement(MemberStreak, { streak: idle })))).toContain('Şu an aktif seri yok.')
  })

  it('sekme yalnızca seri alanı olan (sürüm 8) pakette çıkar; sürüm 7 pakette yoktur', () => {
    expect(shell(analysis())).toContain('data-testid="member-tab-streak"')
    expect(textOf(shell(analysis()))).toContain('SERİ TAKİBİ')
    const v7 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v7 as { v: number }).v = 7
    withoutMkt(v7)
    delete v7.streak
    for (const d of v7.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v7.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v7)).not.toThrow()
    const old = shell(analysis(), NOW, null, v7)
    expect(old).not.toContain('member-tab-streak')
    expect([...old.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/uye', '/uye/istatistik'])
    expect(old).toContain('data-testid="member-card"')
  })
})

describe('üye kartı: form, gol ve gol yemediği maç satırları (sürüm 9)', () => {
  // useId kimlikleri sunucu çıktısında ağaçtaki konuma bağlıdır (tarayıcıda anahtar sabit olduğundan korunur): karşılaştırmada ayıklanır.
  const cardsOf = (markup: string): string[] => markup.split('data-testid="member-card"').slice(1).map((card) => card.slice(0, card.indexOf('</article>')).replace(/_R_[0-9a-zA-Z]+_/g, '_R_'))
  const cardOf = (home: string, p: MemberPayload = payload): string => cardsOf(html(createElement(MemberAnalysis, { payload: p, today: DAY, initialDay: 0, initialCategory: 'over25' }))).find((c) => c.includes(home))!

  it('doğrulanan maçta sabit satırlar: G/B/M kutucukları, gol ve gol yemediği maç; açılır kutu yok', () => {
    const card = cardOf('Kuzey Yıldızı')
    expect(card).toContain('data-testid="member-form"')
    const text = textOf(card)
    expect(text).toContain('Son 5 maç (sağdaki en yeni) · Gol: attığı–yediği')
    // Ham W W D W W -> G G B G G; L W D W L -> M G B G M (en sağdaki en yeni)
    expect(text).toContain('Ev 1. sıra · 8 maç Galibiyet, Galibiyet, Beraberlik, Galibiyet, Galibiyet G G B G G Gol 18–6 Gol yemediği maç: %50')
    expect(text).toContain('Dep 4. sıra · 7 maç Mağlubiyet, Galibiyet, Beraberlik, Galibiyet, Mağlubiyet M G B G M Gol 10–9 Gol yemediği maç: %29')
    expect(card).not.toMatch(/<details|<summary/)
    // Sıra bilgisi aynı satırda, kutucuklardan önce durur.
    expect(text).toContain('Ev 1. sıra · 8 maç')
    // Ham harfler ve admin notları üyeye görünmez.
    expect(text).not.toMatch(/WWDWW|LWDWL|üyeye gitmez|doğrulanamadı|tablo eski olabilir|turu/)
  })

  it('tablo eski olabilir ya da takım eşleşmiyorsa satırlar hiç çizilmez; sıra satırı kalır', () => {
    const card = cardOf('Doğu Gençlik')
    expect(card).not.toContain('data-testid="member-form"')
    expect(textOf(card)).not.toContain('Son 5 maç')
    expect(textOf(card)).toContain('Ev 9. sıra · 8 maç')
    const noTable = cardOf('İç Anadolu FK')
    expect(noTable).not.toContain('data-testid="member-form"')
    expect(noTable).not.toContain('data-testid="member-standing"')
  })

  it('sürüm 8 paket (alanlar yok) eskisi gibi çizilir', () => {
    const v8 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v8 as { v: number }).v = 8
    withoutMkt(v8)
    for (const d of v8.days) for (const m of d.matches) { delete m.homeForm; delete m.awayForm }
    for (const scope of ['all', 'shared'] as const) delete v8.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v8)).not.toThrow()
    const card = cardOf('Kuzey Yıldızı', v8)
    expect(card).not.toContain('data-testid="member-form"')
    expect(textOf(card)).toContain('Ev 1. sıra · 8 maç')
  })

  it('satırlarda yasak kelime ve bahis terimi yok', () => {
    const text = textOf(withoutMarketText(cardOf('Kuzey Yıldızı'))).toLocaleLowerCase('tr')
    expect(/oran|piyasa|xg|csv|kaynak|footystats|bağlantı|odds|ortalama|bahis|kupon|iddaa|banko|clean sheet/.exec(text)?.[0] ?? null).toBeNull()
  })

  it('"Nasıl okunur?" tek cümleyle açıklar: form son 5 maç; gol ve gol yemediği maç tüm lig maçları', () => {
    const paragraphs = HOW_TO_READ.find((i) => i.title === 'Lig sırası ve oynanan maç')!.paragraphs
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]).toBe('“Son 5 maç” satırı takımın son beş maçıdır (G galibiyet, B beraberlik, M mağlubiyet; en sağdaki en yeni); “Gol” ve “Gol yemediği maç” ise ligde şimdiye kadar oynanan tüm maçlara aittir.')
    expect(paragraphs[1].match(/[.!?](\s|$)/g)).toHaveLength(1)
  })
})

describe('istatistik sayfası: İY 0.5 ÜST tutmadığında 2. yarı kutusu', () => {
  const page = (all: { n: number; over: number | null }, shared: { n: number; over: number | null } = { n: 0, over: null }, scope: 'all' | 'shared' = 'all') => {
    const p = JSON.parse(JSON.stringify(payload)) as MemberPayload
    p.statistics.all.htScoreless = all
    p.statistics.shared.htScoreless = shared
    assertMemberPayload(p)
    return html(createElement(MemberStatsPage, { payload: p, initialScope: scope }))
  }
  const card = (markup: string): string => textOf(/<section[^>]*data-testid="member-ht-card"[\s\S]*?<\/section>/.exec(markup)![0])
  const ADVICE = /tahmin|fırsat|öner|bekle|oyna|bahis|kupon|oran|kazan|garanti|şans|yatır/

  it('N < 20: yalnızca maç sayısı ve "Deneme aşamasında · az örnek"; yüzde yok', () => {
    const text = card(page({ n: 19, over: null }))
    expect(text).toContain('İY 0.5 ÜST TUTMADIĞINDA 2. YARI')
    expect(text).toContain('19 maç')
    expect(text).toContain('⚠ Deneme aşamasında · az örnek')
    expect(text).toContain('İlk yarısı 0-0 biten 19 maç ölçüldü. Yüzde, en az 20 maç ölçülünce gösterilecek.')
    expect(text).toContain('Geçmiş maçların sayımıdır; ölçümdür, tavsiye değildir.')
    expect(text).not.toContain('%')
    expect(text).not.toContain(' / ')
  })

  it('20 ≤ N < 50: yüzde ve sayılar görünür; "az örnek" uyarısı kalır', () => {
    const text = card(page({ n: 24, over: 14 }))
    expect(text).toContain(`${formatRate(58.3)} · 14 / 24 maç`)
    expect(text).toContain('⚠ az örnek')
    expect(text).not.toContain('Deneme aşamasında')
    expect(text).toContain('İlk yarısı 0-0 biten 24 maçın 14 tanesinde 2. yarıda en az 2 gol oldu. Maç sayısı az; bu yüzde tesadüfen yüksek ya da düşük çıkmış olabilir.')
    expect(text).toContain('ölçümdür, tavsiye değildir')
    // Tam eşikte de yüzde görünür
    expect(card(page({ n: 20, over: 10 }))).toContain(`${formatRate(50)} · 10 / 20 maç`)
  })

  it('N ≥ 50: uyarı yok', () => {
    const text = card(page({ n: 50, over: 31 }))
    expect(text).toContain(`${formatRate(62)} · 31 / 50 maç`)
    expect(text).not.toContain('az örnek')
    expect(text).not.toContain('tesadüfen')
    expect(text).toContain('ölçümdür, tavsiye değildir')
  })

  it('N = 0: boş durum metni', () => {
    const text = card(page({ n: 0, over: null }))
    expect(text).toContain(MEMBER_HT_SCORELESS_TEXT.empty)
    expect(text).not.toContain('%')
    expect(text).not.toContain('az örnek')
  })

  it('"Paylaşılan" ölçüsü kendi sayısını gösterir', () => {
    const markup = page({ n: 24, over: 14 }, { n: 6, over: null }, 'shared')
    expect(card(markup)).toContain('6 maç')
    expect(card(markup)).toContain('Deneme aşamasında')
    expect(card(markup)).not.toContain('%')
  })

  it('kutu "ZAMAN İÇİNDE BAŞARI"dan önce, kategori kartlarından sonra gelir', () => {
    const text = textOf(page({ n: 24, over: 14 }))
    expect(text.indexOf('KATEGORİ BAZLI BAŞARI')).toBeLessThan(text.indexOf(MEMBER_HT_SCORELESS_TEXT.title))
    expect(text.indexOf(MEMBER_HT_SCORELESS_TEXT.title)).toBeLessThan(text.indexOf('ZAMAN İÇİNDE BAŞARI'))
  })

  it('metinlerde ileriye dönük ya da tavsiye dili yok; yalnızca geçmiş sayım', () => {
    for (const markup of [page({ n: 19, over: null }), page({ n: 24, over: 14 }), page({ n: 50, over: 31 }), page({ n: 0, over: null })]) {
      const text = card(markup).toLocaleLowerCase('tr').replace('ölçümdür, tavsiye değildir', '')
      expect(ADVICE.exec(text)?.[0] ?? null).toBeNull()
      expect(text).not.toContain('tavsiye')
    }
  })

  it('sürüm 9 paket (alan yok) yeni sitede açılır; kutu görünmez, sayfanın kalanı çizilir', () => {
    const v9 = JSON.parse(JSON.stringify(payload)) as MemberPayload
    ;(v9 as { v: number }).v = 9
    withoutMkt(v9)
    for (const scope of ['all', 'shared'] as const) delete v9.statistics[scope].htScoreless
    expect(() => assertMemberPayload(v9)).not.toThrow()
    const markup = html(createElement(MemberStatsPage, { payload: v9 }))
    expect(markup).not.toContain('member-ht-card')
    expect(textOf(markup)).not.toContain(MEMBER_HT_SCORELESS_TEXT.title)
    expect(textOf(markup)).toContain('KATEGORİ BAZLI BAŞARI')
    expect(textOf(markup)).toContain('ZAMAN İÇİNDE BAŞARI')
  })
})

describe('üye kartı: piyasa yüzdesi (sürüm 11)', () => {
  // useId kimlikleri sunucu çıktısında ağaçtaki konuma bağlıdır (tarayıcıda anahtar sabit olduğundan korunur): karşılaştırmada ayıklanır.
  const cardsOf = (markup: string): string[] => markup.split('data-testid="member-card"').slice(1).map((card) => card.slice(0, card.indexOf('</article>')).replace(/_R_[0-9a-zA-Z]+_/g, '_R_'))
  const cards = (p: MemberPayload, categoryId: (typeof CATEGORIES)[number]['id']) => cardsOf(html(createElement(MemberAnalysis, { payload: p, today: DAY, initialDay: 0, initialCategory: categoryId })))
  const over25 = payload.days[0].lists.find((l) => l.categoryId === 'over25')!

  it('değeri olan kartta Model satırının altında, yıldızlardan önce "Piyasa %N"; "?" kapalı gelir, not çizilmez', () => {
    const item = over25.items[0]
    expect(item.mkt).toBeDefined()
    const card = cards(payload, 'over25')[0]
    const line = /data-testid="member-market"[\s\S]*?<\/p>/.exec(card)![0]
    // Görünen metin: etiket, yüzde ve (ekran okuyucudan gizli) "?" işareti.
    expect(textOf(`<p ${line}`)).toBe(`${MEMBER_MARKET_LABEL} %${item.mkt} ?`)
    expect(card.indexOf('member-percent-label')).toBeLessThan(card.indexOf('member-market'))
    if (item.model !== null) expect(card.indexOf('member-model')).toBeLessThan(card.indexOf('member-market'))
    expect(card.indexOf('member-market"')).toBeLessThan(card.indexOf('role="img"'))
    // "?" düğmesi: erişilebilir adı var, kapalı gelir ve notu gösterir/gizler; not kapalıyken hiç çizilmez.
    const toggle = /<button[^>]*data-testid="member-market-toggle"[^>]*>/.exec(card)![0]
    expect(toggle).toContain(`aria-label="${MEMBER_MARKET_NOTE_BUTTON}"`)
    expect(toggle).toContain('aria-expanded="false"')
    expect(toggle).toMatch(/aria-controls="[^"]+"/)
    expect(card).not.toContain('member-market-note')
    expect(card).not.toContain(MEMBER_MARKET_NOTE)
  })

  it('değeri olmayan kartta ve oransız listelerde satır, düğme ve boşluk yoktur', () => {
    // Oransız listeler (2.5 Üst & KG Var, kart, Taraf & Gol): alan hiç yok.
    for (const categoryId of ['over25btts', 'cards35', 'homeWin15'] as const) {
      const list = payload.days[0].lists.find((l) => l.categoryId === categoryId)!
      expect(list.items.length, categoryId).toBeGreaterThan(0)
      for (const card of cards(payload, categoryId)) expect(card, categoryId).not.toContain('member-market')
    }
    // Oranlı listede değer yoksa kart, sürüm 10 kartıyla bayt bayt aynıdır (boş satır ya da yer tutucu yok).
    const none = JSON.parse(JSON.stringify(payload)) as MemberPayload
    withoutMkt(none)
    expect(cards(none, 'over25').every((card) => !card.includes('member-market'))).toBe(true)
    const v10 = JSON.parse(JSON.stringify(none)) as MemberPayload
    ;(v10 as { v: number }).v = 10
    expect(() => assertMemberPayload(v10)).not.toThrow()
    expect(cards(v10, 'over25')).toEqual(cards(none, 'over25'))
  })

  it('sürüm 1-10 paketler açılır; satır görünmez', () => {
    for (const version of [1, 5, 9, 10]) {
      const old = JSON.parse(JSON.stringify(payload)) as MemberPayload
      withoutMkt(old)
      ;(old as { v: number }).v = version
      const markup = html(createElement(MemberAnalysis, { payload: old, today: DAY, initialDay: 0, initialCategory: 'over25' }))
      expect(markup, String(version)).toContain('data-testid="member-card"')
      expect(markup, String(version)).not.toContain('member-market')
    }
  })

  it('piyasa yüzdesi yalnızca kartın kendi satırındadır: diğer öneriler, öne çıkanlar ve seri sayfasına girmez', () => {
    const markup = html(createElement(MemberAnalysis, { payload, today: DAY, initialDay: 0, initialCategory: 'over25' }))
    const others = [...markup.matchAll(/data-testid="member-others"[\s\S]*?<\/p>/g)].map((m) => m[0]).join(' ')
    expect(others.length).toBeGreaterThan(0)
    expect(others).not.toContain(MEMBER_MARKET_LABEL)
    const highlights = /data-testid="member-highlights"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? ''
    expect(highlights).not.toContain(MEMBER_MARKET_LABEL)
    expect(html(createElement(MemberStreak, { streak: payload.streak! }))).not.toContain(MEMBER_MARKET_LABEL)
    expect(textOf(html(createElement(MemberStatsPage, { payload })))).not.toContain(MEMBER_MARKET_LABEL)
  })

  it('metinler: "Nasıl okunur?" ile aynı cümle; oran, bahis, kazanç, tahmin, öneri, fırsat ve değer dili yok', () => {
    expect(HOW_TO_READ.find((i) => i.title === MEMBER_MARKET_LABEL)!.paragraphs).toEqual([MEMBER_MARKET_NOTE])
    expect(MEMBER_MARKET_NOTE).toBe('Maç öncesi piyasa fiyatlamasından hesaplanan olasılık; bilgi amaçlıdır. Kartın büyük yüzdesinden ayrı bir ölçüdür.')
    for (const text of [MEMBER_MARKET_LABEL, MEMBER_MARKET_NOTE, MEMBER_MARKET_NOTE_BUTTON]) {
      expect(/oran|bahis|kazan|tahmin|öner|fırsat|değer|kupon|iddaa|banko|xg|csv|kaynak|odds|ortalama|\d/.exec(text.toLocaleLowerCase('tr'))?.[0] ?? null, text).toBeNull()
    }
  })
})

describe('liste sıralaması: Yüzdeye göre | Saate göre', () => {
  // useId kimlikleri sunucu çıktısında ağaçtaki konuma bağlıdır (tarayıcıda anahtar sabit olduğundan korunur): karşılaştırmada ayıklanır.
  const cardsOf = (markup: string): string[] => markup.split('data-testid="member-card"').slice(1).map((card) => card.slice(0, card.indexOf('</article>')).replace(/_R_[0-9a-zA-Z]+_/g, '_R_'))
  /** Kartın sıra numarası (sol üstteki yuvarlak) */
  const rankOf = (card: string): number => Number(/rounded-full bg-navy-600 px-1\.5 font-bold text-white">(\d+)</.exec(card)![1])
  const item = (match: number, percent: number) => ({ match, percent, model: null, conflict: null, stars: 3, reliability: 'high' as const, outcome: null, detail: null, others: [] })
  const match = (time: string | null) => ({ home: 'A', away: 'B', league: null, time, status: null, score: null, homeStanding: null, awayStanding: null })

  it('yüzde modunda paketteki sıra aynen kalır; numara 1, 2, 3…', () => {
    const items = [item(0, 90), item(1, 85), item(2, 80)]
    const ordered = orderItems(items, [match('21:00'), match('13:00'), match('18:00')], 'percent')
    expect(ordered.map((r) => r.item)).toEqual(items)
    expect(ordered.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('saat modunda saat artan; eşit saatte paketteki sıra; saati olmayan sona; numara değişmez', () => {
    const matches = [match('21:00'), match(null), match('00:30'), match('19:00'), match('19:00'), match(null), match('13:15')]
    const items = [item(0, 95), item(1, 94), item(2, 93), item(3, 92), item(4, 91), item(5, 90), item(6, 89)]
    const ordered = orderItems(items, matches, 'time')
    expect(ordered.map((r) => r.rank)).toEqual([3, 7, 4, 5, 1, 2, 6])
    expect(ordered.map((r) => matches[r.item.match].time)).toEqual(['00:30', '13:15', '19:00', '19:00', '21:00', null, null])
    // Girdi dizisi değişmez (paketteki sıra korunur).
    expect(items.map((i) => i.match)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('gece yarısını geçen maç (00:30) günün listesinde en başta; aynı saatli maçlar mevcut sırayı korur', () => {
    const ordered = orderItems([item(0, 90), item(1, 80), item(2, 70)], [match('23:45'), match('00:30'), match('23:45')], 'time')
    expect(ordered.map((r) => r.rank)).toEqual([2, 1, 3])
  })

  // Fikstürün 2.5 ÜST listesine bilinen saatler verilir: gece yarısı, eşit saatler ve saati olmayan maç.
  const timed = structuredClone(payload)
  const timedDay = timed.days[0]
  const timedList = timedDay.lists.find((l) => l.categoryId === 'over25')!
  const TIMES = ['21:45', null, '00:30', '19:00', '19:00']
  timedList.items.forEach((it, i) => (timedDay.matches[it.match].time = TIMES[i % TIMES.length]))
  const render = (sortMode?: 'percent' | 'time') => html(createElement(MemberAnalysis, { payload: timed, today: DAY, initialDay: 0, initialCategory: 'over25', ...(sortMode && { sortMode }) }))

  it('fikstür listesi sıralamayı sınayacak kadar uzun', () => {
    expect(timedList.items.length).toBeGreaterThanOrEqual(TIMES.length)
  })

  it('varsayılan "Yüzdeye göre": geçiş kategori satırında, basılı düğme aria-pressed; not ve duyuru yok', () => {
    const markup = render()
    expect(markup).toContain(`role="group" aria-label="${SORT_GROUP_LABEL}" data-testid="member-sort"`)
    expect(markup).toMatch(/aria-pressed="true" data-testid="member-sort-percent"/)
    expect(markup).toMatch(/aria-pressed="false" data-testid="member-sort-time"/)
    expect(markup).not.toContain('member-sort-note')
    expect(markup).toMatch(/aria-live="polite" data-testid="member-sort-live"><\/span>/)
    // Geçiş, liste satırıyla aynı kapta (dar ekranda alt satıra iner).
    expect(markup).toMatch(/flex-wrap[^>]*><p[^>]*data-testid="member-list-meta">[\s\S]*?<\/p><div[^>]*data-testid="member-sort"/)
    expect(cardsOf(markup).map(rankOf)).toEqual(timedList.items.map((_, i) => i + 1))
  })

  it('"Saate göre": kartlar saate göre dizilir, numara ve kartın içeriği (yıldız, rozet) birebir aynı kalır', () => {
    const byPercent = cardsOf(render('percent'))
    const markup = render('time')
    const byTime = cardsOf(markup)
    expect(markup).toMatch(/aria-pressed="true" data-testid="member-sort-time"/)
    expect(textOf(markup)).toContain(TIME_SORT_NOTE)
    expect(byTime).toHaveLength(byPercent.length)
    // Her kart, yüzde modundaki kendi kartının aynısıdır (yalnızca yeri değişir).
    for (const card of byTime) expect(byPercent[rankOf(card) - 1]).toBe(card)
    const times = byTime.map((card) => timedDay.matches[timedList.items[rankOf(card) - 1].match].time)
    const known = times.filter((t) => t !== null)
    expect(known).toEqual([...known].sort())
    expect(times.slice(known.length).every((t) => t === null)).toBe(true)
    expect(times[0]).toBe('00:30')
    // Eşit saatte numara artan.
    for (let i = 1; i < byTime.length; i++) if (times[i] === times[i - 1]) expect(rankOf(byTime[i])).toBeGreaterThan(rankOf(byTime[i - 1]))
  })

  it('yeni metinlerde oran, bahis, kazanç, tahmin, öneri, fırsat, değer, piyasa ve aciliyet dili yok; "#" yok', () => {
    for (const text of [SORT_GROUP_LABEL, ...Object.values(SORT_LABELS), ...Object.values(SORT_ANNOUNCE), TIME_SORT_NOTE]) {
      expect(/oran|bahis|kazan|tahmin|öner|fırsat|değer|piyasa|kupon|iddaa|banko|yaklaşan|kaçırma|acele|hemen|#/.exec(text.toLocaleLowerCase('tr'))?.[0] ?? null, text).toBeNull()
    }
    expect(TIME_SORT_NOTE).toBe('Numara, yüzde sırasını gösterir.')
  })
})
