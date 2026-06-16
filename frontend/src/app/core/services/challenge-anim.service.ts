import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChallengeAnimService {
  readonly active = signal(false);

  // Bars + text + blur all start fading at 1.8s (0.5–0.6s out).
  // Keep active for 2.9s so the full sequence is always visible.
  private readonly MIN_MS = 2900;
  private showAt = 0;
  private dismissTimer?: ReturnType<typeof setTimeout>;

  show() {
    clearTimeout(this.dismissTimer);
    this.showAt = Date.now();
    this.active.set(true);
  }

  dismiss() {
    if (!this.active()) return;
    const remaining = this.MIN_MS - (Date.now() - this.showAt);
    if (remaining <= 0) {
      this.active.set(false);
    } else {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = setTimeout(() => this.active.set(false), remaining);
    }
  }
}
