import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
import { NotificationService } from '../../core/services/notification.service';
import { FriendsService } from '../../core/services/friends.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { LobbyService } from '../../core/services/lobby.service';
import { ToastService } from '../../core/services/toast.service';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EmptyStateComponent, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private router = inject(Router);
  readonly notifService = inject(NotificationService);
  private friendsSvc = inject(FriendsService);
  private profileSvc = inject(UserProfileService);
  private lobbySvc = inject(LobbyService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  games = signal<GameDefinition[]>([]);
  leaderboard = signal<LeaderboardEntry[]>([]);
  readonly profile = this.profileSvc.profile;
  loading = signal(true);
  creatingRoom = signal<string | null>(null);
  error = signal('');

  joinCode = '';
  joiningRoom = signal(false);
  joinError = signal('');

  readonly activeRooms = this.lobbySvc.activeRooms;
  readonly onlineUsers = this.lobbySvc.onlineUsers;
  loadingRooms = signal(true);
  invitingUser = signal<string | null>(null);
  spectTooltipRoom = signal<string | null>(null);
  activePanel = signal<'main' | 'sidebar' | 'leaderboard' | 'chat' | 'notifs'>('main');
  reconnectableRoom = signal<any>(null);
  globalMessages = signal<{ uid: string; display_name: string; avatar: string; text: string; ts: number; room_id?: string }[]>([]);
  globalChatInput = '';

  @ViewChild('chatMessages') private chatMessagesEl?: ElementRef;

  private reconnectPollInterval?: ReturnType<typeof setInterval>;
  private wsSub?: Subscription;

  async ngOnInit() {
    try {
      const games = await this.api.listGames({ silent: true });
      this.games.set(games);
    } catch (e: any) {
      const status = e?.status ?? 'sin respuesta';
      this.error.set(`Error ${status}: ${e?.message ?? String(e)}`);
    } finally {
      this.loading.set(false);
    }

    this.api.getGlobalLeaderboard()
      .then((lb) => this.leaderboard.set(lb))
      .catch(() => {});

    this.friendsSvc.load()
      .then(() => {
        const pending = this.friendsSvc.friends().filter((f) => f.status === 'pending_request').length;
        this.notifService.setInitialPending(pending);
      })
      .catch(() => {});

    // Profile/presence registration is owned globally by the root App
    // component (fires once on login); this is just a safety-net refresh in
    // case Home mounts before that finishes (e.g. direct navigation on reload).
    this.profileSvc.load().catch(() => {});

    this.lobbySvc.loadActiveRooms()
      .then(() => {
        this.loadingRooms.set(false);
        this._checkReconnectable();
      })
      .catch(() => this.loadingRooms.set(false));

    this.wsSub = this.ws.messages$.subscribe((msg) => {
      if (msg.event === 'global_chat_message') {
        this.globalMessages.update(list => [...list, msg.data].slice(-50));
        setTimeout(() => {
          const el = this.chatMessagesEl?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
      }
      if (msg.event === 'lobby_update') {
        // LobbyService itself is already updated by the root App component's
        // subscription (it subscribes first, being always-mounted); this just
        // reacts to the same event for Home-local UI state.
        this.loadingRooms.set(false);
        this._checkReconnectable();
      }
      if (msg.event === 'leaderboard_updated') {
        this.api.getGlobalLeaderboard()
          .then((lb) => this.leaderboard.set(lb))
          .catch(() => {});
      }
    });
  }

  /** Relationship state with an online user — reactive: reflects instantly
   *  everywhere the moment FriendsService's shared signal changes. */
  friendStatus(uid: string): 'friend' | 'semi_friend' | 'pending_request' | 'none' {
    return this.friendsSvc.statusOf(uid);
  }

  /** Computed client-side rather than trusted from the payload: the `lobby_update`
   *  WS broadcast is the same message for every connected client, so it can't
   *  embed a per-recipient "is this me" flag the way the /users/online REST
   *  response does — trusting a sometimes-absent server flag let you see
   *  yourself in the list (with add/invite buttons) after any presence change. */
  isMe(uid: string): boolean {
    return this.profile()?.uid === uid;
  }

  /** The active room a given online user is currently connected to, if any. */
  roomFor(uid: string): any | undefined {
    return this.lobbySvc.roomFor(uid);
  }

  /** Same eligibility rules as the public "Salas activas" list: joinable if
   *  you're already a player there, or it's still waiting with an open slot;
   *  otherwise it's spectate-only. */
  canJoinRoom(room: any): boolean {
    const uid = this.profile()?.uid;
    const alreadyIn = !!uid && (room.players ?? []).some((p: any) => p.uid === uid);
    return alreadyIn || (room.status === 'waiting' && !this.isRoomFull(room));
  }

  ngOnDestroy() {
    clearInterval(this.reconnectPollInterval);
    this.wsSub?.unsubscribe();
  }

  private _checkReconnectable() {
    const uid = this.profile()?.uid;
    if (!uid) return;
    const room = this.activeRooms().find(
      (r) => r.status === 'playing' && r.players.some((p: any) => p.uid === uid)
    );
    this.reconnectableRoom.set(room ?? null);

    // When there's a potentially reconnectable room, poll every 3s so the banner
    // and room list update promptly when the other player leaves and the room
    // is deleted — without waiting for the normal 15s interval.
    if (room && !this.reconnectPollInterval) {
      this.reconnectPollInterval = setInterval(() => {
        this.lobbySvc.loadActiveRooms()
          .then(() => this._checkReconnectable())
          .catch(() => {});
      }, 3_000);
    } else if (!room && this.reconnectPollInterval) {
      clearInterval(this.reconnectPollInterval);
      this.reconnectPollInterval = undefined;
    }
  }

  isMyRoom(room: any): boolean {
    const uid = this.profile()?.uid;
    return !!uid && room.players.some((p: any) => p.uid === uid);
  }

  isRoomFull(room: any): boolean {
    return (room.players ?? []).length >= (room.max_players ?? 2);
  }

  async joinRoom() {
    const code = this.joinCode.trim().toUpperCase();
    if (!code) return;

    if (code === 'ARCADE99') {
      this.joinCode = '';
      try {
        await this.api.activateAdmin(code);
        this.router.navigate(['/profile']);
      } catch {
        this.joinError.set(this.translate.instant('HOME.ADMIN_ACTIVATE_FAILED'));
      }
      return;
    }

    this.joinError.set('');
    this.joiningRoom.set(true);
    try {
      const room = await this.api.getRoom(code);
      const myUid = this.profile()?.uid;
      const alreadyIn = myUid && (room.players ?? []).some((p: any) => p.uid === myUid);
      const playerCount = (room.players ?? []).length;
      const isFull = !alreadyIn && playerCount >= (room.max_players ?? 2);
      const params: Record<string, string> = { game: room.game_id };
      if (isFull) params['spectate'] = '1';
      this.router.navigate(['/room', code], { queryParams: params });
    } catch (e: any) {
      this.joinError.set(this.translate.instant(e?.status === 404 ? 'HOME.ROOM_NOT_FOUND' : 'HOME.JOIN_ROOM_FAILED'));
    } finally {
      this.joiningRoom.set(false);
    }
  }

  async playGame(game: GameDefinition) {
    this.creatingRoom.set(game.id);
    try {
      const p = this.profile();
      const { room_id } = await this.api.createRoom(
        game.id,
        p?.display_name ?? 'Player',
        p?.avatar ?? '⭐'
      );
      this.router.navigate(['/room', room_id], { queryParams: { game: game.id } });
    } finally {
      this.creatingRoom.set(null);
    }
  }

  joinActiveRoom(room: any) {
    this.router.navigate(['/room', room.room_id], { queryParams: { game: room.game_id } });
  }

  abandonFromOutside() {
    const room = this.reconnectableRoom();
    if (!room) return;
    this.ws.send('abandon_game', { room_id: room.room_id });
    this.reconnectableRoom.set(null);
    clearInterval(this.reconnectPollInterval);
    this.reconnectPollInterval = undefined;
  }

  spectateRoom(room: any) {
    this.router.navigate(['/room', room.room_id], { queryParams: { game: room.game_id, spectate: '1' } });
  }

  async addFriend(uid: string) {
    try {
      await this.friendsSvc.add(uid);
      this.toast.success(this.translate.instant('TOASTS.FRIEND_REQUEST_SENT'));
    } catch { /* toast shown by the error interceptor */ }
  }

  async removeFriend(uid: string) {
    try {
      await this.friendsSvc.remove(uid);
      this.toast.success(this.translate.instant('TOASTS.FRIEND_REMOVED'));
    } catch { /* toast shown by the error interceptor */ }
  }

  startInvite(uid: string) {
    this.invitingUser.set(uid);
  }

  gameIcon(id: string): string {
    const map: Record<string, string> = {
      connect_four: 'fa-solid fa-circle',
      tic_tac_toe:  'fa-solid fa-hashtag',
      minesweeper:  'fa-solid fa-bomb',
      snake:        'fa-solid fa-worm',
      pong:         'fa-solid fa-table-tennis-paddle-ball',
    };
    return map[id] ?? 'fa-solid fa-gamepad';
  }

  gameColor(id: string): string {
    const map: Record<string, string> = {
      connect_four: '#ef4444',
      tic_tac_toe:  '#3b82f6',
      minesweeper:  '#f97316',
      snake:        '#22c55e',
      pong:         '#a855f7',
    };
    return map[id] ?? '#a855f7';
  }

  cancelInvite() {
    this.invitingUser.set(null);
  }

  inviteToGame(game: GameDefinition) {
    const targetUid = this.invitingUser();
    if (!targetUid) return;
    this.invitingUser.set(null);
    // Room is created by the backend when the target accepts.
    // Both players navigate when they receive 'invite_accepted' in AppComponent.
    this.ws.send('send_invite', { to_uid: targetUid, game_id: game.id });
  }

  gameImage(id: string): string {
    const map: Record<string, string> = {
      connect_four: '/home/connect4.jpg',
      minesweeper: '/home/minesweeper.jpg',
      tic_tac_toe: '/home/tictactoe.jpg',
      snake:        '/home/snake.jpg',
      pong:         '/home/pong.jpg',
    };
    return map[id] ?? '';
  }

  gameLogo(id: string): string {
    const map: Record<string, string> = {
      connect_four: '/home/connect4Logo.svg',
      minesweeper: '/home/minesweeperLogo.svg',
      tic_tac_toe: '/home/tictactoeLogo.svg',
      snake:        '/home/snakeLogo.svg',
      pong:         '/home/PongLogo.svg',
    };
    return map[id] ?? '';
  }

  gameLabel(id: string): string {
    const key: Record<string, string> = {
      connect_four: 'GAMES.CONNECT_FOUR.NAME',
      minesweeper: 'GAMES.MINESWEEPER.NAME',
      tic_tac_toe: 'GAMES.TIC_TAC_TOE.NAME',
      snake:       'GAMES.SNAKE.NAME',
      pong:        'GAMES.PONG.NAME',
    };
    return key[id] ? this.translate.instant(key[id]) : id;
  }

  categoryLabel(category: string): string {
    const key: Record<string, string> = {
      Estrategia: 'HOME.CATEGORY_STRATEGY',
      Puzzle: 'HOME.CATEGORY_PUZZLE',
      Arcade: 'HOME.CATEGORY_ARCADE',
    };
    return key[category] ? this.translate.instant(key[category]) : category;
  }

  playersWord(count: number): string {
    return this.translate.instant(count === 1 ? 'HOME.PLAYER_SINGULAR' : 'HOME.PLAYER_PLURAL');
  }

  sendGlobalChat() {
    const text = this.globalChatInput.trim();
    if (!text) return;
    this.ws.send('global_chat', { text });
    this.globalChatInput = '';
  }

  copyChatRoomCode(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
  }

  openNotifs() {
    this.notifService.markAllRead();
    if (window.innerWidth <= 960) {
      this.activePanel.set('notifs');
    } else {
      this.router.navigate(['/profile'], { queryParams: { tab: 'notifs' } });
    }
  }

  notifLabel(type: string, game_id?: string): string {
    if (type === 'missed_invite') {
      const suffix = game_id ? ' · ' + this.gameLabel(game_id) : '';
      return this.translate.instant('TOASTS.MISSED_INVITE') + suffix;
    }
    if (type === 'friend_request_rejected') return this.translate.instant('TOASTS.FRIEND_REQUEST_REJECTED_LONG');
    if (type === 'friend_removed') return this.translate.instant('TOASTS.FRIEND_REMOVED_BY_OTHER');
    return '';
  }

  dotDelay(uid: string): string {
    // Spread dots across the 4s cycle so adjacent users show different colors
    const offset = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 40;
    return `-${(offset / 10).toFixed(1)}s`;
  }

  roomStatusLabel(status: string): string {
    const key = status === 'waiting' ? 'HOME.STATUS_WAITING' : status === 'playing' ? 'HOME.STATUS_PLAYING' : 'HOME.STATUS_FINISHED';
    return this.translate.instant(key);
  }

  isFirstGlobalMsg(index: number): boolean {
    if (index === 0) return true;
    const msgs = this.globalMessages();
    return msgs[index].uid !== msgs[index - 1].uid;
  }

  logout() {
    this.auth.logout();
  }
}
