import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { UserProfile } from '../models/user.model';

/**
 * Single shared source of truth for the logged-in user's own Firestore
 * profile (display_name, avatar, settings, ...). Home, Profile, GameRoom and
 * the root App component all read/write the same signal instead of each
 * keeping an independent copy from their own `getMe()` call — which is what
 * let a user's WS presence registration go stale (see AuthService.currentUser's
 * `displayName`, which is a *different*, Firebase-Auth-only field frozen at
 * signup time and never touched again — do not use it as a name source).
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private api = inject(ApiService);

  private _profile = signal<UserProfile | null>(null);
  readonly profile = this._profile.asReadonly();

  async load(): Promise<UserProfile> {
    const p = await this.api.getMe();
    this._profile.set(p);
    return p;
  }

  set(profile: UserProfile): void {
    this._profile.set(profile);
  }

  update(patch: Partial<UserProfile>): void {
    this._profile.update((p) => (p ? { ...p, ...patch } : p));
  }

  clear(): void {
    this._profile.set(null);
  }
}
