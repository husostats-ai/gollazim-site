import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMBER_TEXTS } from '../../config/memberTexts'
import { IssuedBox, type Issued } from './MemberAdminSection'
import type { MemberAdminData } from './useMemberAdmin'

// Şifrelerin bir kez gösterildiği kutu (tarayıcısız çizim). Değerler sentetiktir.

const data: MemberAdminData = { members: [], publications: [], meta: { siteSalt: null, publishCounter: 0, texts: DEFAULT_MEMBER_TEXTS, keysChangedAt: null, lastKeyBackupAt: null } }
const noop = () => undefined
const draw = (issued: Issued) => renderToStaticMarkup(createElement(IssuedBox, { issued, data, busy: false, onClose: noop, onDownloaded: noop, onRepublish: noop }))
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const one = { username: 'ali', password: 'ABCD-EFGH-JKMN-PQRS' }
const two = { username: 'veli', password: '2345-6789-WXYZ-TVRS' }

describe('bir kez gösterilen şifre kutusu', () => {
  it('kullanıcı adı ve şifre görünür; şifrenin yalnızca şimdi göründüğü büyükçe yazar', () => {
    const markup = draw({ logins: [one], kind: 'new', downloaded: false })
    expect(text(markup)).toContain('ŞİFRELER YALNIZCA ŞİMDİ GÖRÜNÜR')
    expect(markup).toContain('ABCD-EFGH-JKMN-PQRS')
    expect(text(markup)).toContain('Hesap mesajını kopyala')
    expect(text(markup)).toContain('Şifreyi kopyala')
  })

  it('tek üyede dağıtım listesi yoktur; toplu eklemede "BU DOSYA ŞİFRE İÇERİR" uyarısıyla sunulur', () => {
    expect(draw({ logins: [one], kind: 'new', downloaded: false })).not.toContain('member-distribution-download')
    const bulk = draw({ logins: [one, two], kind: 'new', downloaded: false })
    expect(text(bulk)).toContain('BU DOSYA ŞİFRE İÇERİR')
    expect(text(bulk)).toContain('dosyayı SİLİN')
    expect(text(bulk)).toContain('Dağıtım listesini indir (CSV)')
  })

  it('dağıtım listesi bir kez indirilir: indirildikten sonra düğme kapanır', () => {
    const markup = draw({ logins: [one, two], kind: 'new', downloaded: true })
    expect(/<button[^>]*disabled=""[^>]*data-testid="member-distribution-download"/.test(markup)).toBe(true)
    expect(text(markup)).toContain('Dağıtım listesi indirildi')
  })

  it('şifre yenilemede yeniden yayın önerilir', () => {
    const markup = draw({ logins: [one], kind: 'renew', downloaded: false })
    expect(text(markup)).toContain('Eski şifre, yeniden yayınlanana dek yayındaki paketi açmaya devam eder.')
    expect(markup).toContain('data-testid="member-republish-now"')
    expect(draw({ logins: [one], kind: 'new', downloaded: false })).not.toContain('member-republish-now')
  })
})
