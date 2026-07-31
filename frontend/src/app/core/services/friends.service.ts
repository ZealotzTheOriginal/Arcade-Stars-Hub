import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

export type FriendStatus = 'friend' | 'semi_friend' | 'pending_request';

export interface FriendEntry {
  uid: string;
  display_name: string;
  avatar: string;
  level: number;
  total_points: number;
  best_game: string | null;
  best_game_points: number;
  status: FriendStatus;
}

/**
 * Single shared source of truth for the friends list. Home, Profile and the
 * root App component all read the same signal, so accepting/adding/removing
 * a friend anywhere in the app is reflected instantly everywhere else (the
 * online-list heart, profile tabs, pending count) without each component
 * having to independently refetch.
 */
@Injectable({ providedIn: 'root' })
export class FriendsService {
  private api = inject(ApiService);

  private _friends = signal<FriendEntry[]>([]);
  readonly friends = this._friends.asReadonly();

  async load(): Promise<void> {
    const list = await this.api.getFriends();
    this._friends.set(list as FriendEntry[]);
  }

  statusOf(uid: string): FriendStatus | 'none' {
    return this._friends().find((f) => f.uid === uid)?.status ?? 'none';
  }

  async add(uid: string): Promise<void> {
    await this.api.addFriend(uid);
    await this.load();
  }

  async accept(uid: string): Promise<void> {
    await this.api.acceptFriendRequest(uid);
    this._friends.update((list) => list.map((f) => (f.uid === uid ? { ...f, status: 'friend' as const } : f)));
  }

  async reject(uid: string): Promise<void> {
    await this.api.rejectFriendRequest(uid);
    this._friends.update((list) => list.filter((f) => f.uid !== uid));
  }

  async remove(uid: string): Promise<void> {
    await this.api.removeFriend(uid);
    this._friends.update((list) => list.filter((f) => f.uid !== uid));
  }
}
