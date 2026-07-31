import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
import { NotificationService } from '../../core/services/notification.service';
import { FriendsService } from '../../core/services/friends.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ToastService } from '../../core/services/toast.service';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';

type Tab = 'stats' | 'games' | 'friends' | 'ranking' | 'notifs' | 'admin';

const AVATARS = [
  '🐉', '🦎', '🐀', '🦅', '🐺', '🦁', '🦂', '🦈',
  '🛸', '👾', '🐜', '🕷️', '🧬',
  '🛰️', '🚀', '🚀', '🌌', '☄️', '🪐',
  '🛡️', '⚔️', '🎯', '💥', '⚡', '🔮', '🌀', '🔋',
  '👑', '🏆', '⭐', '🎖️'
];

const BADGE_DEFS = [
  { id: 'beta',      label: 'Beta',      color: '#6366f1', icon: 'fa-flask' },
  { id: 'payaso',    label: 'Payaso',    color: '#f59e0b', icon: 'fa-face-grin-squint-tears' },
  { id: 'eminencia', label: 'Eminencia', color: '#10b981', icon: 'fa-crown' },
  { id: 'hardcore',  label: 'Hardcore',  color: '#ef4444', icon: 'fa-skull' },
];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EmptyStateComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly notifService = inject(NotificationService);
  private friendsSvc = inject(FriendsService);
  private profileSvc = inject(UserProfileService);
  private toast = inject(ToastService);
  private wsSub?: Subscription;

  readonly profile = this.profileSvc.profile;
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
  avatarPickerUid = signal<string | null>(null);
  badgesTargetUid = signal<string | null>(null);
  badgesEditing = signal<string[]>([]);

  readonly avatars = AVATARS;
  readonly badgeDefs = BADGE_DEFS;

  readonly gameNames: Partial<Record<string, string>> = {
    connect_four: 'Conecta Cuatro',
    tic_tac_toe: 'Tres en Raya',
    minesweeper: 'Buscaminas',
  };

  async ngOnInit() {
    const [profile, lb, gamesData] = await Promise.all([
      this.profileSvc.load(),
      this.api.getGlobalLeaderboard(),
      this.api.listGames(),
    ]);
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
      await this.friendsSvc.load();
    } catch { /* silent */ } finally {
      this.loadingFriends.set(false);
    }
  }

  pendingRequests() {
    return this.friendsSvc.friends().filter(f => f.status === 'pending_request');
  }

  acceptedFriends() {
    return this.friendsSvc.friends().filter(f => f.status !== 'pending_request');
  }

  async selectAvatar(avatar: string) {
    try {
      await this.api.updateMe({ avatar } as any);
      this.profileSvc.update({ avatar });
      this.toast.success('Avatar actualizado');
    } catch { /* toast shown by the error interceptor */ }
  }

  async saveName() {
    if (!this.editName.trim()) return;
    this.saving.set(true);
    try {
      const updated = await this.api.updateMe({ display_name: this.editName } as any);
      this.profileSvc.set(updated);
      // Keep Firebase Auth's displayName from drifting from Firestore's again.
      this.auth.updateDisplayName(this.editName).catch(() => {});
      this.toast.success('Nombre actualizado');
    } catch {
      /* toast shown by the error interceptor */
    } finally {
      this.saving.set(false);
    }
  }

  async removeFriend(uid: string) {
    this.openMenuUid.set(null);
    try {
      await this.friendsSvc.remove(uid);
      this.toast.success('Amigo eliminado');
    } catch { /* toast shown by the error interceptor */ }
  }

  async acceptFriendRequest(uid: string) {
    try {
      await this.friendsSvc.accept(uid);
      this.toast.success('Solicitud aceptada');
    } catch { /* toast shown by the error interceptor */ }
  }

  async rejectFriendRequest(uid: string) {
    try {
      await this.friendsSvc.reject(uid);
      this.toast.success('Solicitud rechazada');
    } catch { /* toast shown by the error interceptor */ }
  }

  goHome() {
    this.router.navigate(['/home']);
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

  openAvatarPicker(uid: string) {
    this.openAdminMenuUid.set(null);
    this.avatarPickerUid.set(uid);
  }

  async adminConfirmAvatar(avatar: string) {
    const uid = this.avatarPickerUid();
    if (!uid) return;
    this.avatarPickerUid.set(null);
    await this.api.adminSetAvatar(uid, avatar);
    this.adminUsers.update(list => list.map(u => u.uid === uid ? { ...u, avatar } : u));
  }

  openBadgeManager(uid: string) {
    this.openAdminMenuUid.set(null);
    const user = this.adminUsers().find(u => u.uid === uid);
    this.badgesEditing.set(user?.badges ? [...user.badges] : []);
    this.badgesTargetUid.set(uid);
  }

  toggleBadgeEdit(badgeId: string) {
    const current = this.badgesEditing();
    if (current.includes(badgeId)) {
      this.badgesEditing.set(current.filter(b => b !== badgeId));
    } else {
      this.badgesEditing.set([...current, badgeId]);
    }
  }

  async adminSaveBadges() {
    const uid = this.badgesTargetUid();
    if (!uid) return;
    const badges = this.badgesEditing();
    this.badgesTargetUid.set(null);
    await this.api.adminSetBadges(uid, badges);
    this.adminUsers.update(list => list.map(u => u.uid === uid ? { ...u, badges } : u));
  }

  logout() { this.auth.logout(); }
}
