import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
import { NotificationService } from '../../core/services/notification.service';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';
import { UserProfile } from '../../core/models/user.model';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private router = inject(Router);
  readonly notifService = inject(NotificationService);

  games = signal<GameDefinition[]>([]);
  leaderboard = signal<LeaderboardEntry[]>([]);
  profile = signal<UserProfile | null>(null);
  loading = signal(true);
  creatingRoom = signal<string | null>(null);
  error = signal('');

  joinCode = '';
  joiningRoom = signal(false);
  joinError = signal('');

  activeRooms = signal<any[]>([]);
  onlineUsers = signal<any[]>([]);
  loadingRooms = signal(true);
  invitingUser = signal<string | null>(null);
  spectTooltipRoom = signal<string | null>(null);
  activePanel = signal<'main' | 'sidebar' | 'leaderboard' | 'chat' | 'notifs'>('main');
  reconnectableRoom = signal<any>(null);
  globalMessages = signal<{ uid: string; display_name: string; avatar: string; text: string; ts: number; room_id?: string }[]>([]);
  globalChatInput = '';

  @ViewChild('chatMessages') private chatMessagesEl?: ElementRef;

  private pollInterval?: ReturnType<typeof setInterval>;
  private reconnectPollInterval?: ReturnType<typeof setInterval>;
  private wsSub?: Subscription;

  async ngOnInit() {
    try {
      const games = await this.api.listGames();
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

    this.api.getFriends()
      .then((list) => {
        const pending = list.filter((f: any) => f.is_pending_request).length;
        this.notifService.setInitialPending(pending);
      })
      .catch(() => {});

    this.api.getMe()
      .then((p) => {
        this.profile.set(p);
        this.ws.send('register_presence', { display_name: p.display_name, avatar: p.avatar });
        // Auth token is now cached and presence is registered; refresh online list promptly.
        // Small delay gives the WS message time to be processed on the backend.
        setTimeout(() => {
          this.api.getOnlineUsers()
            .then((users) => this.onlineUsers.set(users))
            .catch(() => {});
          this._checkReconnectable();
        }, 350);
      })
      .catch(() => {});

    this._fetchLive();
    // Polling is a fallback for missed WS events; primary updates come via lobby_update
    this.pollInterval = setInterval(() => this._fetchLive(), 15_000);

    this.wsSub = this.ws.messages$.subscribe((msg) => {
      if (msg.event === 'global_chat_message') {
        this.globalMessages.update(list => [...list, msg.data].slice(-50));
        setTimeout(() => {
          const el = this.chatMessagesEl?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
      }
      if (msg.event === 'lobby_update') {
        this.activeRooms.set(msg.data.rooms ?? []);
        this.onlineUsers.set(msg.data.online_users ?? []);
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

  ngOnDestroy() {
    clearInterval(this.pollInterval);
    clearInterval(this.reconnectPollInterval);
    this.wsSub?.unsubscribe();
  }

  private _fetchLive() {
    this.api.listActiveRooms()
      .then((rooms) => {
        this.activeRooms.set(rooms);
        this.loadingRooms.set(false);
        this._checkReconnectable();
      })
      .catch(() => this.loadingRooms.set(false));

    this.api.getOnlineUsers()
      .then((users) => this.onlineUsers.set(users))
      .catch(() => {});
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
        this.api.listActiveRooms()
          .then((rooms) => {
            this.activeRooms.set(rooms);
            this._checkReconnectable();
          })
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
        this.joinError.set('No se pudo activar el modo administrador.');
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
      this.joinError.set(e?.status === 404 ? 'Sala no encontrada.' : 'Error al unirse a la sala.');
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

  isFriend(uid: string): boolean {
    return (this.profile()?.friends ?? []).includes(uid);
  }

  async addFriend(uid: string) {
    try {
      await this.api.addFriend(uid);
      this.profile.update(p => p ? { ...p, friends: [...(p.friends ?? []), uid] } : p);
    } catch { /* ignore */ }
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
    };
    return map[id] ?? 'fa-solid fa-gamepad';
  }

  gameColor(id: string): string {
    const map: Record<string, string> = {
      connect_four: '#ef4444',
      tic_tac_toe:  '#3b82f6',
      minesweeper:  '#f97316',
      snake:        '#22c55e',
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
    };
    return map[id] ?? '';
  }

  gameLogo(id: string): string {
    const map: Record<string, string> = {
      connect_four: '/home/connect4Logo.svg',
      minesweeper: '/home/minesweeperLogo.svg',
      tic_tac_toe: '/home/tictactoeLogo.svg',
      snake:        '/home/snakeLogo.svg',
    };
    return map[id] ?? '';
  }

  gameLabel(id: string): string {
    const map: Record<string, string> = {
      connect_four: 'Conecta 4',
      minesweeper: 'Buscaminas',
      tic_tac_toe: 'Tres en Raya',
      snake:       'Serpiente',
    };
    return map[id] ?? id;
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
    if (type === 'missed_invite') return `Te invitó a jugar${game_id ? ' · ' + game_id.replace('_', ' ') : ''}`;
    if (type === 'friend_request_rejected') return 'Rechazó tu solicitud de amistad';
    if (type === 'friend_removed') return 'Te eliminó de amigos';
    return '';
  }

  dotDelay(uid: string): string {
    // Spread dots across the 4s cycle so adjacent users show different colors
    const offset = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 40;
    return `-${(offset / 10).toFixed(1)}s`;
  }

  roomStatusLabel(status: string): string {
    return status === 'waiting' ? 'Esperando' : status === 'playing' ? 'En juego' : 'Terminada';
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
