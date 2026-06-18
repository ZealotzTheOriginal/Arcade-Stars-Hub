import {
  Component, OnInit, OnDestroy, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, interval } from 'rxjs';

import { WsService } from '../../core/services/ws.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { ChallengeAnimService } from '../../core/services/challenge-anim.service';
import { PlayerInfo } from '../../core/models/game.model';
import { ChatMessage } from '../../core/models/ws-events.model';

import { HudComponent } from '../../shared/components/hud/hud.component';
import { ChatComponent } from '../../shared/components/chat/chat.component';
import { ConnectFourComponent } from './games/connect-four/connect-four.component';
import { TicTacToeComponent } from './games/tic-tac-toe/tic-tac-toe.component';
import { MinesweeperComponent } from './games/minesweeper/minesweeper.component';

@Component({
  selector: 'app-game-room',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    HudComponent, ChatComponent,
    ConnectFourComponent, TicTacToeComponent, MinesweeperComponent,
  ],
  templateUrl: './game-room.component.html',
  styleUrls: ['./game-room.component.scss'],
})
export class GameRoomComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ws = inject(WsService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private challengeAnim = inject(ChallengeAnimService);

  roomId = '';
  gameId = '';
  myUid = '';
  myProfile: any = null;

  players = signal<PlayerInfo[]>([]);
  spectators = signal<any[]>([]);
  gameState = signal<any>(null);
  roomStatus = signal<string>('waiting');
  chatMessages = signal<ChatMessage[]>([]);
  aiThinking = signal(false);
  elapsedSeconds = signal(0);
  gameOverData = signal<any>(null);
  rematchVotes = signal<string[]>([]);
  isSpectator = signal(false);
  disconnectedUids = signal<Set<string>>(new Set());
  toast = signal<string | null>(null);
  abandonedData = signal<{ uid: string; display_name: string } | null>(null);
  abandonCountdown = signal(5);
  maxPlayersShake = signal<number | null>(null);
  colorSwapRequest = signal<{ requester_uid: string; requester_name: string; requester_color: string; target_color: string } | null>(null);
  coinFlipData = signal<{ name: string; avatar: string; color: string } | null>(null);
  showAbandonConfirm = signal(false);
  roomName = signal('');
  isInvited = signal(false);
  chatOpen = signal(false);
  friends = signal<any[]>([]);
  onlineUids = signal<Set<string>>(new Set());
  showFriendsModal = signal(false);
  leaderUid = signal('');
  minPlayers = signal(2);
  maxPlayers = signal(2);
  playerColors = signal<Partial<Record<string, string>>>({});
  tttPatterns = signal<Partial<Record<string, string>>>({});
  gameMode = signal<'ffa' | 'teams'>('ffa');
  teams = signal<{ a: string[]; b: string[] }>({ a: [], b: [] });

  isLeader = computed(() => !!this.myUid && this.myUid === this.leaderUid());
  canStart = computed(() => this.players().length >= this.maxPlayers());
  canAddAI = computed(() => this.players().length < this.maxPlayers());
  myColor = computed(() => this.playerColors()[this.myUid] ?? '');
  myTttPattern = computed(() => this.tttPatterns()[this.myUid] ?? 'Classic');

  readonly TTT_PATTERNS = ['Classic', 'Modern', 'Cyberpunk', 'Abstract', 'Squishy'];
  previewPiece = signal<'X' | 'O'>('X');

  msBoardSize = signal<string>('normal');
  readonly MS_BOARD_SIZES = [
    { id: 'normal',       label: 'Normal',     detail: '9×9 · 10 minas' },
    { id: 'intermediate', label: 'Intermedio', detail: '16×16 · 40 minas' },
    { id: 'expert',       label: 'Experto',    detail: '30×16 · 99 minas' },
  ];
  isWinner = computed(() => {
    const winner = this.gameOverData()?.winner;
    if (!winner) return false;
    if (winner === this.myUid) return true;
    if (this.gameMode() === 'teams') {
      const t = this.teams();
      const myTeam = t.a?.includes(this.myUid) ? 'a' : t.b?.includes(this.myUid) ? 'b' : null;
      const winTeam = t.a?.includes(winner) ? 'a' : t.b?.includes(winner) ? 'b' : null;
      return myTeam !== null && winTeam === myTeam;
    }
    return false;
  });
  playerSlots = computed<(PlayerInfo | null)[]>(() =>
    Array.from({ length: this.maxPlayers() }, (_, i) => this.players()[i] ?? null)
  );

  readonly CHIP_COLORS = [
    '#ef4444', '#3b82f6', '#eab308', '#22c55e',
    '#a855f7', '#f97316', '#ec4899', '#06b6d4',
  ];

  private subs: Subscription[] = [];
  private timerSub?: Subscription;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private coinFlipTimer?: ReturnType<typeof setTimeout>;
  private abandonCdRef?: ReturnType<typeof setInterval>;
  private previewInterval?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    this.roomId = this.route.snapshot.paramMap.get('roomId') ?? '';
    this.gameId = this.route.snapshot.queryParamMap.get('game') ?? '';
    const spectateParam = this.route.snapshot.queryParamMap.get('spectate');
    this.isInvited.set(this.route.snapshot.queryParamMap.get('invited') === '1');
    this.myUid = this.auth.currentUser()?.uid ?? '';
    this.myProfile = await this.api.getMe();

    if (this.gameId === 'tic_tac_toe') {
      this.previewInterval = setInterval(
        () => this.previewPiece.set(this.previewPiece() === 'X' ? 'O' : 'X'),
        1200
      );
    }

    // Load friends + online users for the lobby invite panel
    Promise.all([this.api.getFriends(), this.api.getOnlineUsers()]).then(([fr, online]) => {
      this.friends.set(fr);
      this.onlineUids.set(new Set(online.map((u: any) => u.uid)));
    }).catch(() => {});

    await this.ws.connect();

    this.subs.push(
      this.ws.messages$.subscribe((msg) => this.handleMessage(msg)),
      this.ws.reconnected$.subscribe(() => this._joinOrSpectate()),
    );

    if (spectateParam === '1') {
      this.isSpectator.set(true);
      this._spectate();
    } else {
      this._joinRoom();
    }
  }

  ngOnDestroy() {
    this.ws.send('leave_room', {});
    this.subs.forEach((s) => s.unsubscribe());
    this.timerSub?.unsubscribe();
    clearTimeout(this.toastTimer);
    clearTimeout(this.coinFlipTimer);
    clearInterval(this.abandonCdRef);
    clearInterval(this.previewInterval);
    // WS stays alive — managed at app level for invites
  }

  private handleMessage(msg: any) {
    switch (msg.event) {
      case 'room_state':
        this.players.set(msg.data.players ?? []);
        this.spectators.set(msg.data.spectators ?? []);
        this.roomStatus.set(msg.data.status ?? 'waiting');
        if (msg.data.name) this.roomName.set(msg.data.name);
        if (msg.data.leader_uid) this.leaderUid.set(msg.data.leader_uid);
        if (msg.data.min_players) this.minPlayers.set(msg.data.min_players);
        if (msg.data.max_players) this.maxPlayers.set(msg.data.max_players);
        if (msg.data.player_colors) this.playerColors.set(msg.data.player_colors);
        if (msg.data.ms_board_size) this.msBoardSize.set(msg.data.ms_board_size);
        if (msg.data.ttt_patterns !== undefined) {
          const patterns: Record<string, string> = { ...msg.data.ttt_patterns };
          if (this.gameId === 'tic_tac_toe' && !patterns[this.myUid] && this.myProfile?.ttt_pattern) {
            patterns[this.myUid] = this.myProfile.ttt_pattern;
            this.ws.send('set_ttt_pattern', { room_id: this.roomId, pattern: this.myProfile.ttt_pattern });
          }
          this.tttPatterns.set(patterns);
        }
        if (msg.data.game_mode) this.gameMode.set(msg.data.game_mode);
        if (msg.data.teams) this.teams.set(msg.data.teams);
        if (!this.isSpectator() && !msg.data.players?.find((p: any) => p.uid === this.myUid)) {
          this.isSpectator.set(true);
        }
        break;

      case 'player_joined':
        if (!this.players().find((p) => p.uid === msg.data.uid)) {
          this.players.update((ps) => [...ps, msg.data.player]);
        }
        break;

      case 'player_left':
        this.players.update((ps) => ps.filter((p) => p.uid !== msg.data.uid));
        break;

      case 'spectator_joined':
        if (!this.spectators().find((s: any) => s.uid === msg.data.uid)) {
          this.spectators.update((ss) => [...ss, msg.data.spectator]);
        }
        break;

      case 'spectator_left':
        this.spectators.update((ss) => ss.filter((s: any) => s.uid !== msg.data.uid));
        break;

      case 'game_started':
        this.players.set(msg.data.players ?? []);
        this.gameState.set(msg.data.game_state);
        this.challengeAnim.dismiss();
        if (msg.data.reconnected) {
          this.showToast('Reconectado a la partida');
          this.disconnectedUids.set(new Set());
        } else {
          this.startTimer();
          const firstUid: string = msg.data.game_state?.current_turn;
          const first = (msg.data.players ?? []).find((p: any) => p.uid === firstUid);
          if (first) {
            const colors: Record<string, string> = msg.data.player_colors ?? {};
            this.coinFlipData.set({
              name: (first as any).display_name,
              avatar: (first as any).avatar,
              color: colors[firstUid] ?? this.playerColors()[firstUid] ?? '#888',
            });
            clearTimeout(this.coinFlipTimer);
            this.coinFlipTimer = setTimeout(() => this.coinFlipData.set(null), 3500);
          }
        }
        this.roomStatus.set('playing');
        this.gameOverData.set(null);
        this.rematchVotes.set([]);
        break;

      case 'move_made':
        this.gameState.set(msg.data.game_state);
        this.aiThinking.set(false);
        break;

      case 'game_over':
        this.gameState.set(msg.data.game_state);
        this.roomStatus.set('finished');
        this.gameOverData.set(msg.data);
        this.rematchVotes.set(msg.data.rematch_votes ?? []);
        this.stopTimer();
        break;

      case 'rematch_vote':
        this.rematchVotes.set(msg.data.votes ?? []);
        break;

      case 'game_reset':
        this.gameOverData.set(null);
        this.gameState.set(null);
        this.roomStatus.set('waiting');
        this.rematchVotes.set([]);
        this.players.set(msg.data.players ?? []);
        this.elapsedSeconds.set(0);
        this.stopTimer();
        break;

      case 'chat_message':
        this.chatMessages.update((msgs) => [...msgs, {
          uid: msg.data.uid,
          display_name: msg.data.display_name,
          message: msg.data.message,
          is_spectator: msg.data.is_spectator,
        }]);
        break;

      case 'ai_thinking':
        this.aiThinking.set(true);
        break;

      case 'player_disconnected':
        this.disconnectedUids.update((s) => new Set([...s, msg.data.uid]));
        this.showToast(`${msg.data.display_name} se desconectó`);
        break;

      case 'player_reconnected':
        this.disconnectedUids.update((s) => {
          const ns = new Set(s);
          ns.delete(msg.data.uid);
          return ns;
        });
        this.showToast(`${msg.data.display_name} se reconectó`);
        break;

      case 'game_abandoned': {
        this.abandonedData.set({ uid: msg.data.uid, display_name: msg.data.display_name });
        this.roomStatus.set('finished');
        this.stopTimer();
        this.abandonCountdown.set(5);
        clearInterval(this.abandonCdRef);
        this.abandonCdRef = setInterval(() => this.abandonCountdown.update(n => Math.max(0, n - 1)), 1000);
        break;
      }

      case 'color_swap_request':
        this.colorSwapRequest.set(msg.data);
        break;

      case 'color_swap_declined':
        this.showToast(`${msg.data.target_name} rechazó el cambio de color`);
        break;

      case 'room_closed':
        this.router.navigate(['/home']);
        break;

      case 'kicked':
        this.router.navigate(['/home']);
        break;
    }
  }

  private _joinRoom() {
    this.ws.send('join_room', {
      room_id: this.roomId,
      game_id: this.gameId,
      player_info: {
        display_name: this.myProfile?.display_name ?? 'Player',
        avatar: this.myProfile?.avatar ?? '⭐',
      },
    });
  }

  private _spectate() {
    this.ws.send('spectate_room', {
      room_id: this.roomId,
      spectator_info: {
        display_name: this.myProfile?.display_name ?? 'Espectador',
        avatar: this.myProfile?.avatar ?? '👁️',
      },
    });
  }

  private _joinOrSpectate() {
    if (this.isSpectator()) {
      this._spectate();
    } else {
      this._joinRoom();
    }
  }

  makeMove(move: any) {
    if (this.isSpectator()) return;
    this.ws.send('make_move', { room_id: this.roomId, move });
  }

  startGame() {
    this.ws.send('start_game', { room_id: this.roomId });
  }

  addAI() {
    this.ws.send('add_ai_player', { room_id: this.roomId });
  }

  setPlayerColor(hex: string) {
    const blocker = this.colorBlocker(hex);
    if (!blocker || (blocker as any).is_ai) {
      this.ws.send('set_player_color', { room_id: this.roomId, color: hex });
      return;
    }
    this.ws.send('request_color_swap', { room_id: this.roomId, target_uid: blocker.uid });
    this.showToast('Solicitud de cambio de color enviada...');
  }

  respondColorSwap(accept: boolean) {
    const req = this.colorSwapRequest();
    if (!req) return;
    this.ws.send('respond_color_swap', { room_id: this.roomId, requester_uid: req.requester_uid, accept });
    this.colorSwapRequest.set(null);
  }

  setGameMode(mode: 'ffa' | 'teams') {
    this.ws.send('set_game_mode', { room_id: this.roomId, mode });
  }

  setMaxPlayers(n: number) {
    const humanCount = this.humanPlayers().length;
    if (humanCount > n) {
      this.showToast(`Hay ${humanCount} jugadores humanos en la sala. Expulsa a uno para reducir el límite.`);
      this.maxPlayersShake.set(n);
      setTimeout(() => this.maxPlayersShake.set(null), 500);
      return;
    }
    this.ws.send('set_max_players', { room_id: this.roomId, max_players: n });
  }

  kickPlayer(uid: string) {
    this.ws.send('kick_player', { room_id: this.roomId, uid });
  }

  transferLeader(uid: string) {
    this.ws.send('transfer_leader', { room_id: this.roomId, target_uid: uid });
  }

  setMsBoardSize(size: string) {
    this.ws.send('set_ms_board_size', { room_id: this.roomId, board_size: size });
  }

  setTttPattern(pattern: string) {
    this.ws.send('set_ttt_pattern', { room_id: this.roomId, pattern });
    if (this.myProfile) this.myProfile.ttt_pattern = pattern;
    this.api.updateMe({ ttt_pattern: pattern }).catch(() => {});
  }

  joinAsPlayer() {
    this.isSpectator.set(false);
    this._joinRoom();
  }

  assignTeam(targetUid: string, team: 'a' | 'b') {
    this.ws.send('assign_team', { room_id: this.roomId, uid: targetUid, team });
  }

  colorBlocker(hex: string): PlayerInfo | null {
    const myTeam = this.gameMode() === 'teams' ? this.playerTeam(this.myUid) : null;
    const entry = Object.entries(this.playerColors()).find(([uid, color]) => {
      if (color !== hex || uid === this.myUid) return false;
      if (myTeam !== null) return this.playerTeam(uid) !== myTeam;
      return true;
    });
    if (!entry) return null;
    return this.players().find(p => p.uid === entry[0]) ?? null;
  }

  isColorTaken(hex: string): boolean {
    const blocker = this.colorBlocker(hex);
    return blocker !== null && !(blocker as any).is_ai;
  }

  isInRoom(uid: string): boolean {
    return this.players().some(p => p.uid === uid);
  }

  playerTeam(uid: string): 'a' | 'b' | null {
    const t = this.teams();
    if (t.a?.includes(uid)) return 'a';
    if (t.b?.includes(uid)) return 'b';
    return null;
  }

  hasAI(): boolean {
    return this.players().some((p: any) => p.is_ai);
  }

  isFriendOnline(uid: string): boolean {
    return this.onlineUids().has(uid);
  }

  inviteFriend(uid: string) {
    this.ws.send('send_invite', { to_uid: uid, game_id: this.gameId, room_id: this.roomId });
    this.showFriendsModal.set(false);
  }

  requestRematch() {
    this.ws.send('request_rematch', { room_id: this.roomId });
  }

  hasVotedRematch(): boolean {
    return this.rematchVotes().includes(this.myUid);
  }

  humanPlayers(): PlayerInfo[] {
    return this.players().filter((p: any) => !p.is_ai);
  }

  get scores(): Record<string, number> {
    const state = this.gameState();
    return state?.scores ?? {};
  }

  get currentLevel(): number {
    return this.myProfile?.level ?? 1;
  }

  private startTimer() {
    this.timerSub = interval(1000).subscribe(() => {
      this.elapsedSeconds.update((s) => s + 1);
    });
  }

  private stopTimer() {
    this.timerSub?.unsubscribe();
  }

  abandonGame() {
    this.showAbandonConfirm.set(true);
  }

  confirmAbandon() {
    this.showAbandonConfirm.set(false);
    this.ws.send('abandon_game', { room_id: this.roomId });
  }

  cancelAbandon() {
    this.showAbandonConfirm.set(false);
  }

  copyRoomId() {
    navigator.clipboard.writeText(this.roomId).catch(() => {});
  }

  private showToast(msg: string) {
    clearTimeout(this.toastTimer);
    this.toast.set(msg);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3000);
  }
}
