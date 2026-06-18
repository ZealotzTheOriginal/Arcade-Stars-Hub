import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
import { NotificationService } from '../../core/services/notification.service';
import { UserProfile } from '../../core/models/user.model';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';

type Tab = 'stats' | 'games' | 'friends' | 'ranking' | 'notifs' | 'admin';

const AVATARS = [
  '🐉', '🦎', '🐀', '🦅', '🐺', '🦁', '🦂', '🦈',
  '🛸', '👾', '🐜', '🕷️', '🧬',
  '🛰️', '🚀', '🚀', '🌌', '☄️', '🪐',
  '🛡️', '⚔️', '🎯', '💥', '⚡', '🔮', '🌀', '🔋',
  '👑', '🏆', '⭐', '🎖️'
];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private route = inject(ActivatedRoute);
  readonly notifService = inject(NotificationService);
  private wsSub?: Subscription;

  profile = signal<UserProfile | null>(null);
  friends = signal<any[]>([]);
  games = signal<GameDefinition[]>([]);
  leaderboard = signal<LeaderboardEntry[]>([]);
  activeTab = signal<Tab>('stats');
  saving = signal(false);
  loadingFriends = signal(false);
  invitingFriend = signal<string | null>(null);
  openMenuUid = signal<string | null>(null);
  editName = '';

  // Admin
  adminUsers = signal<any[]>([]);
  adminLoading = signal(false);
  openAdminMenuUid = signal<string | null>(null);
  addPointsTarget = signal<string | null>(null);
  addPointsAmount = 0;
  resetAllConfirm = signal(false);

  readonly avatars = AVATARS;

  readonly gameNames: Partial<Record<string, string>> = {
    connect_four: 'Conecta Cuatro',
    tic_tac_toe: 'Tres en Raya',
    minesweeper: 'Buscaminas',
  };

  async ngOnInit() {
    const [profile, lb, gamesData] = await Promise.all([
      this.api.getMe(),
      this.api.getGlobalLeaderboard(),
      this.api.listGames(),
    ]);
    this.profile.set(profile);
    this.leaderboard.set(lb);
    this.games.set(gamesData);
    this.editName = profile.display_name;

    // Open the tab requested via query param (e.g. ?tab=notifs from the bell icon)
    const tabParam = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (tabParam) this.setTab(tabParam);

    // Always load friends on init so notifications tab and pending count work immediately
    this._loadFriends();

    // Listen for live events while profile is open
    this.wsSub = this.ws.messages$.subscribe((msg) => {
      if (msg.event === 'friend_request') {
        this._loadFriends();
      }
      if (msg.event === 'leaderboard_updated') {
        this.api.getGlobalLeaderboard()
          .then((lb) => this.leaderboard.set(lb))
          .catch(() => {});
      }
    });
  }

  ngOnDestroy() {
    this.wsSub?.unsubscribe();
  }

  setTab(tab: Tab) {
    this.activeTab.set(tab);
    if (tab === 'friends' || tab === 'notifs') {
      this._loadFriends();
    }
    if (tab === 'notifs') {
      this.notifService.markAllRead();
    }
    if (tab === 'admin') {
      this._loadAdminUsers();
    }
  }

  private async _loadAdminUsers() {
    this.adminLoading.set(true);
    try {
      this.adminUsers.set(await this.api.adminGetAllUsers());
    } catch { /* ignore */ } finally {
      this.adminLoading.set(false);
    }
  }

  toggleAdminMenu(uid: string) {
    this.openAdminMenuUid.set(this.openAdminMenuUid() === uid ? null : uid);
  }

  async adminSetAdmin(uid: string, isAdmin: boolean) {
    this.openAdminMenuUid.set(null);
    await this.api.adminSetAdmin(uid, isAdmin);
    this.adminUsers.update(list => list.map(u => u.uid === uid ? { ...u, is_admin: isAdmin } : u));
    // Re-sort: admins first
    this.adminUsers.update(list => [...list].sort((a, b) =>
      (a.is_admin === b.is_admin ? 0 : a.is_admin ? -1 : 1) || b.total_points - a.total_points
    ));
  }

  async adminResetPoints(uid: string) {
    this.openAdminMenuUid.set(null);
    await this.api.adminResetPoints(uid);
    this.adminUsers.update(list => list.map(u => u.uid === uid ? { ...u, total_points: 0 } : u));
  }

  openAddPoints(uid: string) {
    this.openAdminMenuUid.set(null);
    this.addPointsAmount = 0;
    this.addPointsTarget.set(uid);
  }

  async adminResetAllPoints() {
    this.resetAllConfirm.set(false);
    await this.api.adminResetAllPoints();
    this.adminUsers.update(list => list.map(u => ({ ...u, total_points: 0 })));
  }

  async confirmAddPoints() {
    const uid = this.addPointsTarget();
    const pts = Number(this.addPointsAmount);
    if (!uid || pts <= 0) return;
    await this.api.adminAddPoints(uid, pts);
    this.adminUsers.update(list => list.map(u => u.uid === uid ? { ...u, total_points: u.total_points + pts } : u));
    this.addPointsTarget.set(null);
  }

  private async _loadFriends() {
    this.loadingFriends.set(true);
    try {
      this.friends.set(await this.api.getFriends());
    } catch { /* silent */ } finally {
      this.loadingFriends.set(false);
    }
  }

  pendingRequests() {
    return this.friends().filter(f => f.is_pending_request);
  }

  acceptedFriends() {
    return this.friends().filter(f => !f.is_pending_request);
  }

  async selectAvatar(avatar: string) {
    await this.api.updateMe({ avatar } as any);
    this.profile.update((p) => p ? { ...p, avatar } : p);
  }

  async saveName() {
    if (!this.editName.trim()) return;
    this.saving.set(true);
    try {
      const updated = await this.api.updateMe({ display_name: this.editName } as any);
      this.profile.set(updated);
    } finally {
      this.saving.set(false);
    }
  }

  async removeFriend(uid: string) {
    this.openMenuUid.set(null);
    try {
      await this.api.removeFriend(uid);
      this.friends.update(list => list.filter(f => f.uid !== uid));
    } catch { /* ignore */ }
  }

  async acceptFriendRequest(uid: string) {
    try {
      await this.api.acceptFriendRequest(uid);
      this.friends.update(list => list.map(f => f.uid === uid ? { ...f, is_pending_request: false } : f));
    } catch { /* ignore */ }
  }

  async rejectFriendRequest(uid: string) {
    try {
      await this.api.rejectFriendRequest(uid);
      this.friends.update(list => list.filter(f => f.uid !== uid));
    } catch { /* ignore */ }
  }

  toggleFriendMenu(uid: string) {
    this.openMenuUid.set(this.openMenuUid() === uid ? null : uid);
  }

  startFriendInvite(uid: string) {
    this.openMenuUid.set(null);
    this.invitingFriend.set(uid);
  }

  gameIcon(id: string): string {
    const map: Record<string, string> = {
      connect_four: 'fa-solid fa-circle',
      tic_tac_toe:  'fa-solid fa-hashtag',
      minesweeper:  'fa-solid fa-bomb',
    };
    return map[id] ?? 'fa-solid fa-gamepad';
  }

  gameColor(id: string): string {
    const map: Record<string, string> = {
      connect_four: '#ef4444',
      tic_tac_toe:  '#3b82f6',
      minesweeper:  '#f97316',
    };
    return map[id] ?? '#a855f7';
  }

  cancelFriendInvite() {
    this.invitingFriend.set(null);
  }

  inviteFriendToGame(game: GameDefinition) {
    const uid = this.invitingFriend();
    if (!uid) return;
    this.invitingFriend.set(null);
    this.ws.send('send_invite', { to_uid: uid, game_id: game.id });
  }

  gameStatsList(): Array<{ id: string; name: string; played: number; won: number; points: number }> {
    const stats = this.profile()?.game_stats ?? {};
    return Object.entries(stats).map(([id, s]) => ({
      id,
      name: this.gameNames[id] ?? id,
      played: s.played,
      won: s.won,
      points: s.points,
    }));
  }

  logout() { this.auth.logout(); }
}
