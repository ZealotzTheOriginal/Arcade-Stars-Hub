import { Injectable, signal } from '@angular/core';

export interface AppNotification {
  id: string;
  type: 'missed_invite' | 'friend_request_rejected' | 'friend_removed';
  from_name: string;
  from_avatar: string;
  game_id?: string;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private _unread = signal(0);
  private _items = signal<AppNotification[]>([]);
  private _initialPendingSet = false;

  readonly unread = this._unread.asReadonly();
  readonly items = this._items.asReadonly();

  setInitialPending(count: number) {
    if (this._initialPendingSet) return;
    this._initialPendingSet = true;
    if (count > 0) this._unread.update(n => n + count);
  }

  addFriendRequest() {
    this._unread.update(n => n + 1);
  }

  addMissedInvite(from_name: string, from_avatar: string, game_id: string) {
    this._push({ type: 'missed_invite', from_name, from_avatar, game_id });
  }

  addFriendRequestRejected(from_name: string, from_avatar: string) {
    this._push({ type: 'friend_request_rejected', from_name, from_avatar });
  }

  addFriendRemoved(from_name: string, from_avatar: string) {
    this._push({ type: 'friend_removed', from_name, from_avatar });
  }

  markAllRead() {
    this._unread.set(0);
  }

  dismiss(id: string) {
    this._items.update(list => list.filter(n => n.id !== id));
  }

  private _push(data: Omit<AppNotification, 'id' | 'timestamp'>) {
    const notif: AppNotification = {
      ...data,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    };
    this._items.update(list => [notif, ...list]);
    this._unread.update(n => n + 1);
  }
}
