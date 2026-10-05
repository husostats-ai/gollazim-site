// Grafik renkleri. Tüm grafikler tek seridir (başarı oranı), bu yüzden renk
// hiçbir yerde tek başına anlam taşımaz: kazandı/kaybetti sayıları metinle,
// "az veri" durumu çizgili dolgu / içi boş nokta ve yazıyla gösterilir.
// MARK rengi koyu zeminde dataviz doğrulayıcısından (parlaklık bandı ve
// zemin kontrastı) geçen logo turuncusudur.
export const CHART = {
  mark: '#e0640f',
  surface: '#0a2a44',
  grid: '#1f4f78',
  text: '#ffffff',
  muted: '#8ea4b8',
} as const
