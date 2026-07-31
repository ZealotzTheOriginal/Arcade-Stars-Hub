import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const LANG_STORAGE_KEY = 'ash_lang';
export type AppLang = 'es' | 'en';

/**
 * Thin wrapper around TranslateService for this app's specific sync rules:
 * the live language always mirrors localStorage (so it works before login,
 * on the auth screens), and is kept in sync with the user's saved Firestore
 * preference once their profile loads.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  get current(): AppLang {
    return (this.translate.getCurrentLang() as AppLang) ?? 'es';
  }

  /** Switches the live UI language and remembers it for this browser. Use
   *  for the pre-login toggle and as the instant client-side effect when the
   *  Settings page saves a new language preference. */
  setLocal(lang: AppLang): void {
    this.translate.use(lang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* localStorage unavailable — language still switches for this session */
    }
  }

  /** Called once the user's Firestore profile loads, so a browser that never
   *  set a local override still shows the account's saved language. */
  syncFromProfile(lang: AppLang | undefined): void {
    if (lang && lang !== this.current) {
      this.setLocal(lang);
    }
  }
}
