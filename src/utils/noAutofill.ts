/**
 * Giriş bilgisi olmayan admin alanları (arama, filtre, etiket, sayı) için: tarayıcının ve şifre
 * yöneticilerinin (1Password, LastPass, Bitwarden, Dashlane) otomatik doldurma önerilerini kapatır.
 * Üye sayfasının giriş alanlarında ve şifre alanlarında kullanılmaz.
 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const
