import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { ErrorInterceptor } from './core/interceptors/error.interceptor';
import { LANG_STORAGE_KEY } from './core/services/language.service';

function getInitialLang(): 'es' | 'en' {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* localStorage unavailable (e.g. privacy mode) — fall through to default */
  }
  return 'es';
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withViewTransitions()),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
    provideTranslateService({
      lang: getInitialLang(),
      fallbackLang: 'es',
      // useHttpBackend: fetches the translation JSON via the raw HttpBackend,
      // bypassing HTTP_INTERCEPTORS entirely. Without this, TranslateService
      // (needed by ErrorInterceptor) needs HttpClient, whose interceptor chain
      // needs ErrorInterceptor again — a circular DI dependency (NG0200).
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json', useHttpBackend: true }),
    }),
  ],
};
