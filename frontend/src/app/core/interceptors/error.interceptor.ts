import { Injectable } from '@angular/core';
import {
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

/** Set to true in an HttpContext to suppress the automatic error toast for
 *  requests whose component already renders its own dedicated error state. */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(private toast: ToastService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.context.get(SKIP_ERROR_TOAST)) {
      return next.handle(req);
    }

    return next.handle(req).pipe(
      catchError((err: HttpErrorResponse) => {
        this.toast.error(this._messageFor(err));
        return throwError(() => err);
      })
    );
  }

  private _messageFor(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Sin conexión con el servidor. Comprueba tu red.';
    const detail = err.error?.detail;
    if (typeof detail === 'string') return detail;
    if (err.status === 401 || err.status === 403) return 'No tienes permiso para hacer esto.';
    if (err.status === 404) return 'No se encontró el recurso solicitado.';
    if (err.status >= 500) return 'Error del servidor. Intenta de nuevo en un momento.';
    return 'Ha ocurrido un error. Intenta de nuevo.';
  }
}
