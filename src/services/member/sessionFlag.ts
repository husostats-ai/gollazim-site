// Üye oturumunun tarayıcıdaki yeri. Bu dosya bilerek bağımlılıksızdır: uygulamanın
// girişinde (main.tsx) "üye oturumu açık mı" sorusu için kullanılır.

export const MEMBER_SESSION_KEY = 'gollazim.uye.oturum'

/** Bu sekmede kayıtlı bir üye oturumu var mı (geçerliliği denetlenmez) */
export function hasMemberSession(): boolean {
  try {
    return sessionStorage.getItem(MEMBER_SESSION_KEY) !== null
  } catch {
    return false
  }
}
