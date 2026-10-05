import { GROUPS, standaloneCategories } from './categories'

export interface NavItem {
  label: string
  to: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'ANA SAYFA', to: '/' },
  ...standaloneCategories().map((c) => ({ label: c.label, to: `/kategori/${c.slug}` })),
  ...GROUPS.map((g) => ({ label: g.label, to: `/${g.slug}` })),
  { label: 'SKOR GİRİŞİ', to: '/skor-girisi' },
  { label: 'İSTATİSTİK', to: '/istatistik' },
  { label: 'ADMİN', to: '/admin' },
]
