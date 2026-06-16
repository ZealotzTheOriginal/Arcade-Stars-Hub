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
  gameState = signal<any>(null);
  roomStatus = signal<string>('waiting');
  chatMessages = signal<ChatMessage[]>([]);
  aiThinking = signal(false);
  elapsedSeconds = signal(0);
  gameOverData = signal<any>(null);

  private subs: Subscription[] = [];
  private timerSub?: Subscription;

  async ngOnInit() {
    this.roomId = this.route.snapshot.paramMap.get('roomId') ?? '';
    this.gameId = this.route.snapshot.queryParamMap.get('game') ?? '';
    this.myUid = this.auth.currentUser()?.uid ?? '';
    this.myProfile = await this.api.getMe();

    await this.ws.connect();

    this.subs.push(
      this.ws.messages$.subscribe((msg) => this.handleMessage(msg)),
      this.ws.reconnected$.subscribe(() => this._joinRoom()),
    );

    this._joinRoom();
  }

  ngOnDestroy() {
    this.ws.send('leave_room', {});
    this.subs.forEach((s) => s.unsubscribe());
    this.timerSub?.unsubscribe();
    this.ws.disconnect();
  }

  private handleMessage(msg: any) {
    switch (msg.event) {
      case 'room_state':
        this.players.set(msg.data.players ?? []);
        this.roomStatus.set(msg.data.status ?? 'waiting');
        break;

      case 'player_joined':
        if (!this.players().find((p) => p.uid === msg.data.uid)) {
          this.players.update((ps) => [...ps, msg.data.player]);
        }
        break;

      case 'player_left':
        this.players.update((ps) => ps.filter((p) => p.uid !== msg.data.uid));
        break;

      case 'game_started':
        this.players.set(msg.data.players ?? []);
        this.gameState.set(msg.data.game_state);
        this.roomStatus.set('playing');
        this.startTimer();
        break;

      case 'move_made':
        this.gameState.set(msg.data.game_state);
        this.aiThinking.set(false);
        break;

      case 'game_over':
        this.gameState.set(msg.data.game_state);
        this.roomStatus.set('finished');
        this.gameOverData.set(msg.data);
        this.stopTimer();
        break;

      case 'chat_message':
        this.chatMessages.update((msgs) => [...msgs, {
          uid: msg.data.uid,
          display_name: msg.data.display_name,
          message: msg.data.message,
        }]);
        break;

      case 'ai_thinking':
        this.aiThinking.set(true);
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

  makeMove(move: any) {
    this.ws.send('make_move', { room_id: this.roomId, move });
  }

  addAI() {
    this.ws.send('add_ai_player', { room_id: this.roomId });
  }

  get scores(): Record<string, number> {
    const state = this.gameState();
    if (!state) return {};
    if (state.scores) return state.scores;
    return {};
  }

  get currentLevel(): number {
    return this.myProfile?.level ?? 1;
  }

  private startTimer() {
    this.timerSub = interval(1000).subscribe(() => {
      this.elapsedSeconds.update((s) => s + 1);
    });
  }

  copyRoomId() {
    navigator.clipboard.writeText(this.roomId).catch(() => {});
  }

  private stopTimer() {
    this.timerSub?.unsubscribe();
  }
}
