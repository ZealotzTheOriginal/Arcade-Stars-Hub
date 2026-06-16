import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tic-tac-toe',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tic-tac-toe.component.html',
  styleUrls: ['./tic-tac-toe.component.scss'],
})
export class TicTacToeComponent {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Output() moveMade = new EventEmitter<{ row: number; col: number }>();

  readonly size = [0, 1, 2];

  get board(): number[][] {
    return this.gameState?.board ?? [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  }

  get isMyTurn(): boolean {
    return this.gameState?.current_turn === this.myUid;
  }

  get myPiece(): number {
    const players: string[] = this.gameState?.players ?? [];
    return players.indexOf(this.myUid) + 1;
  }

  isTerminal(): boolean {
    return !!this.gameState?.winner || !!this.gameState?.draw;
  }

  canPlay(row: number, col: number): boolean {
    return this.isMyTurn && !this.isTerminal() && this.board[row]?.[col] === 0;
  }

  play(row: number, col: number) {
    if (this.canPlay(row, col)) this.moveMade.emit({ row, col });
  }

  cellSymbol(row: number, col: number): string {
    const v = this.board[row]?.[col] ?? 0;
    return v === 1 ? '✕' : v === 2 ? '○' : '';
  }

  cellClass(row: number, col: number): string {
    const v = this.board[row]?.[col] ?? 0;
    const base = 'cell';
    if (v === 1) return `${base} p1`;
    if (v === 2) return `${base} p2`;
    if (this.canPlay(row, col)) return `${base} playable`;
    return base;
  }
}
