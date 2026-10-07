import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../config/categories'
import { DEFAULT_MEMBER_TEXTS } from '../config/memberTexts'
import { MEMBER_STALE_HOURS } from '../config/member'
import { DAY, memberInput, PREVIOUS_DAY, PUBLISHED_AT } from '../services/member/__fixtures__/rawData'
import type { MemberErrorKind } from '../services/member/controller'
import { MEMBER_ERROR_TEXTS, MEMBER_NOTICE_TEXTS, STALE_DATA_TEXT } from '../services/member/labels'
import { buildMemberPayload } from '../services/member/payload'
import { formatRate } from '../utils/format'
import MemberAnalysis from './MemberAnalysis'
import MemberLogin from './MemberLogin'
import MemberShell from './MemberShell'
import MemberStatsPage from './MemberStatsPage'
import { CALCULATORS } from '../services/analysis/calculators'
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
    const markup = login({ busy: true })
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

  it('gün seçici: seçilen gün ve önceki gün; seçilen günün başlığı ve listesi çizilir', () => {
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

  it('kart alanları: saat, lig, hazır yüzde, model, yıldız, güvenilirlik, çelişki, sıra, skor, sonuç', () => {
    const drawn = cards(html(analysis(0, 'over25')))
    const done = drawn.find((c) => c.includes('Kuzey Yıldızı'))!
    expect(done).toContain('12:00')
    expect(done).toContain('Testland · Deneme Ligi')
    expect(done).toContain('2.5 ÜST')
    expect(done).toContain('%88')
    expect(done).toMatch(/Model %\d+/)
    expect(done).toContain('✓ Tuttu')
    expect(done).toContain('İY 1-0 · MS 3-1')
    expect(done).toContain('Güvenilirlik:')
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
    expect(corners[0]).toContain('Güvenilirlik: Ölçülemedi')
  })

  it('Taraf & Gol: "Model tabanlı" etiketi ve "Hesaplar çelişiyor" rozeti', () => {
    const side = html(analysis(0, 'homeWin15'))
    expect(textOf(side)).toMatch(/Model tabanlı/)
    expect(textOf(side)).not.toContain('Güvenilirlik: Model tabanlı')
    expect(side).toContain('data-conflict="hesap"')
    expect(textOf(side)).toContain('⚠ Hesaplar çelişiyor')
    expect(textOf(side)).not.toContain('Model çelişkisi')
    // İkinci yüzdenin adı: Taraf & Gol'de "İkinci hesap", diğerlerinde "Model".
    expect(textOf(side)).toMatch(/İkinci hesap %\d+/)
    expect(textOf(side)).not.toMatch(/Model %\d+/)
    expect(textOf(html(analysis(0, 'over25')))).toMatch(/Model %\d+/)
    expect(textOf(html(analysis(0, 'over25')))).not.toContain('İkinci hesap')
    expect(secondPercentLabel('awayWin25')).toBe('İkinci hesap')
    expect(secondPercentLabel('btts')).toBe('Model')
    expect(html(analysis(0, 'over25'))).not.toContain('data-conflict="hesap"')
  })

  it('"tablo eski" bayrağı yalnızca tablo eskiyse', () => {
    expect(textOf(html(analysis(0, 'over25')))).not.toContain('tablo eski')
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
    expect(PERCENT_NOTE).toBe("Yüzdeler geçmiş verilerin özetidir, sonucun kesin olduğu anlamına gelmez. Güvenilirlik 'Düşük' ise örnek azdır.")
    const markup = html(analysis(0, 'over25'))
    expect(/data-testid="member-percent-note">([^<]*)/.exec(markup)![1].replace(/&#x27;/g, "'")).toBe(PERCENT_NOTE)
    expect(markup.indexOf('member-percent-note')).toBeLessThan(markup.indexOf('member-cards'))
    expect(html(createElement(MemberAnalysis, { payload: buildMemberPayload(memberInput({ days: [{ date: '2026-10-09', matches: [], results: [] }] })), today: DAY }))).not.toContain('member-percent-note')
  })

  it('%100 ve güvenilirlik Düşük ise yüzde sönük, güvenilirlik rozeti belirgin; başka durumda değil', () => {
    expect(isOverstated({ percent: 100, reliability: 'low' })).toBe(true)
    for (const [percent, reliability] of [[100, 'high'], [100, 'medium'], [100, 'unknown'], [100, 'unmeasured'], [99, 'low'], [0, 'low']] as const) expect(isOverstated({ percent, reliability }), `${percent} ${reliability}`).toBe(false)

    // Verideki %100'lük maç "Yüksek" güvenilirlikte: olağan görünüm.
    const normal = html(analysis(0, 'over25'))
    expect(normal).not.toContain('data-overstated="true"')
    expect(/class="([^"]*)" data-testid="member-percent">%100/.exec(normal)![1]).toContain('text-3xl')

    // Aynı maç "Düşük" güvenilirlikte olsaydı
    const low = JSON.parse(JSON.stringify(payload)) as MemberPayload
    low.days[0].lists[0].items[0].reliability = 'low'
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
    expect(textOf(card)).toContain('⚠ Güvenilirlik: Düşük')
    // Yalnızca o kart etkilenir; yüzde ve sıra değişmez.
    expect(markup.split('data-overstated="true"').length - 1).toBe(1)
    expect(cards(markup)[0].startsWith('1 ')).toBe(true)
    expect(cards(markup)[0]).toContain('%100')
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
      expect(text).toContain(`· ${s.overall.decided} öneri · ${s.matches.decided} maç`)
      expect(text).toContain(`Tuttu ${s.overall.won}`)
      expect(text).toContain(`Tutmadı ${s.overall.lost}`)
      for (const bucket of s.byCategory) expect(text).toContain(CATEGORIES.find((c) => c.id === bucket.key)!.label)
    }
    // Sayfa hesap yapmaz: gösterilen başarı, paketteki değerin biçimlendirilmiş hâlidir.
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('all'))![1]).toBe(formatRate(payload.statistics.all.overall.rate))
    expect(/data-testid="member-overall"[^>]*>([^<]*)/.exec(stats('shared'))![1]).toBe('%50')
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

  it('güvenilirlik satırları üye etiketleriyle; az veride uyarı; öneri yoksa boş durum', () => {
    const text = textOf(stats('shared'))
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
