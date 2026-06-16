import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
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
  invitingUser = signal<string | null>(null);  // uid of user we're inviting

  private pollInterval?: ReturnType<typeof setInterval>;

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

    this.api.getMe()
      .then((p) => {
        this.profile.set(p);
        this.ws.send('register_presence', { display_name: p.display_name, avatar: p.avatar });
      })
      .catch(() => {});

    this._fetchLive();
    this.pollInterval = setInterval(() => this._fetchLive(), 15_000);
  }

  ngOnDestroy() {
    clearInterval(this.pollInterval);
  }

  private _fetchLive() {
    // Rooms: no auth needed, update immediately when ready
    this.api.listActiveRooms()
      .then((rooms) => { this.activeRooms.set(rooms); this.loadingRooms.set(false); })
      .catch(() => this.loadingRooms.set(false));

    // Online users: requires auth token, may be slightly slower — independent
    this.api.getOnlineUsers()
      .then((users) => this.onlineUsers.set(users))
      .catch(() => {});
  }

  async joinRoom() {
    const code = this.joinCode.trim().toUpperCase();
    if (!code) return;
    this.joinError.set('');
    this.joiningRoom.set(true);
    try {
      const room = await this.api.getRoom(code);
      this.router.navigate(['/room', code], { queryParams: { game: room.game_id } });
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

  spectateRoom(room: any) {
    this.router.navigate(['/room', room.room_id], { queryParams: { game: room.game_id, spectate: '1' } });
  }

  async addFriend(uid: string) {
    try {
      await this.api.addFriend(uid);
    } catch { /* ignore */ }
  }

  startInvite(uid: string) {
    this.invitingUser.set(uid);
  }

  cancelInvite() {
    this.invitingUser.set(null);
  }

  async inviteToGame(game: GameDefinition) {
    const targetUid = this.invitingUser();
    if (!targetUid) return;
    this.invitingUser.set(null);
    this.creatingRoom.set(game.id);
    try {
      const p = this.profile();
      const { room_id } = await this.api.createRoom(
        game.id,
        p?.display_name ?? 'Player',
        p?.avatar ?? '⭐'
      );
      this.ws.send('send_invite', { to_uid: targetUid, room_id, game_id: game.id });
      this.router.navigate(['/room', room_id], { queryParams: { game: game.id } });
    } finally {
      this.creatingRoom.set(null);
    }
  }

  roomStatusLabel(status: string): string {
    return status === 'waiting' ? 'Esperando' : status === 'playing' ? 'En juego' : 'Terminada';
  }

  logout() {
    this.auth.logout();
  }
}
