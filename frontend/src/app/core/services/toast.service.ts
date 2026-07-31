import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

const DEFAULT_DURATION_MS = 4000;
// Avoids flooding the user with the same failure repeated every few seconds
// while a background poll (rooms, online users...) keeps retrying.
const DEDUPE_WINDOW_MS = 6000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private nextId = 1;
  private recentMessages = new Map<string, number>();

  success(message: string, durationMs = DEFAULT_DURATION_MS): void {
    this._push('success', message, durationMs);
  }

  error(message: string, durationMs = DEFAULT_DURATION_MS): void {
    this._push('error', message, durationMs);
  }

  info(message: string, durationMs = DEFAULT_DURATION_MS): void {
    this._push('info', message, durationMs);
  }

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private _push(variant: ToastVariant, message: string, durationMs: number): void {
    const key = `${variant}:${message}`;
    const now = Date.now();
    const lastShown = this.recentMessages.get(key);
    if (lastShown && now - lastShown < DEDUPE_WINDOW_MS) return;
    this.recentMessages.set(key, now);

    const id = this.nextId++;
    this._toasts.update((list) => [...list, { id, variant, message }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }
}
