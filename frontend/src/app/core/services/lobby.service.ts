import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/**
 * Shared source of truth for "who's online" and "which rooms are active" —
 * both come from the same `lobby_update` WS broadcast, so they're combined
 * here instead of each screen keeping its own copy (which is what let Home
 * see live lobby state while Profile had no access to it at all).
 */
@Injectable({ providedIn: 'root' })
export class LobbyService {
  private api = inject(ApiService);

  private _onlineUsers = signal<any[]>([]);
  private _activeRooms = signal<any[]>([]);
  readonly onlineUsers = this._onlineUsers.asReadonly();
  readonly activeRooms = this._activeRooms.asReadonly();

  async loadOnlineUsers(): Promise<void> {
    this._onlineUsers.set(await this.api.getOnlineUsers());
  }

  async loadActiveRooms(): Promise<void> {
    this._activeRooms.set(await this.api.listActiveRooms());
  }

  setOnlineUsers(users: any[]): void {
    this._onlineUsers.set(users);
  }

  setActiveRooms(rooms: any[]): void {
    this._activeRooms.set(rooms);
  }

  /** The active room a given uid is currently connected to, if any — looked
   *  up via their presence's room_id, which the backend already tracks. */
  roomFor(uid: string): any | undefined {
    const presence = this._onlineUsers().find((u) => u.uid === uid);
    if (!presence?.room_id) return undefined;
    return this._activeRooms().find((r) => r.room_id === presence.room_id);
  }
}
