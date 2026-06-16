import {
  Component, OnInit, OnDestroy, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, interval } from 'rxjs';

import { WsService } from '../../core/services/ws.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
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
  showAbandonConfirm = signal(false);

  private subs: Subscription[] = [];
  private timerSub?: Subscription;
  private toastTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit() {
    this.roomId = this.route.snapshot.paramMap.get('roomId') ?? '';
    this.gameId = this.route.snapshot.queryParamMap.get('game') ?? '';
    const spectateParam = this.route.snapshot.queryParamMap.get('spectate');
    this.myUid = this.auth.currentUser()?.uid ?? '';
    this.myProfile = await this.api.getMe();

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
    // WS stays alive — managed at app level for invites
  }

  private handleMessage(msg: any) {
    switch (msg.event) {
      case 'room_state':
        this.players.set(msg.data.players ?? []);
        this.spectators.set(msg.data.spectators ?? []);
        this.roomStatus.set(msg.data.status ?? 'waiting');
        // Detect if we joined as spectator (not in players list)
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
        if (msg.data.reconnected) {
          this.showToast('Reconectado a la partida');
          this.disconnectedUids.set(new Set());
        } else {
          this.startTimer();
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

      case 'game_abandoned':
        this.abandonedData.set({ uid: msg.data.uid, display_name: msg.data.display_name });
        this.roomStatus.set('finished');
        this.stopTimer();
        break;

      case 'room_closed':
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

  addAI() {
    this.ws.send('add_ai_player', { room_id: this.roomId });
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
