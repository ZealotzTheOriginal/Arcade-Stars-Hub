import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-tic-tac-toe',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './tic-tac-toe.component.html',
  styleUrls: ['./tic-tac-toe.component.scss'],
})
export class TicTacToeComponent {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
  @Input() tttPatterns: Partial<Record<string, string>> = {};
  @Output() moveMade = new EventEmitter<{ row: number; col: number }>();

  readonly size = [0, 1, 2];
  /** Must match MAX_PIECES in backend/app/games/tic_tac_toe/game.py. */
  private readonly MAX_PIECES = 3;

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

  private uidForCell(cell: number): string {
    const players: string[] = this.gameState?.players ?? [];
    return players[cell - 1] ?? '';
  }

  cellColor(cell: number): string {
    const uid = this.uidForCell(cell);
    return this.playerColors[uid] ?? (cell === 1 ? '#ef4444' : '#3b82f6');
  }

  cellPieceUrl(cell: number): string {
    const uid = this.uidForCell(cell);
    const pattern = this.tttPatterns[uid] ?? 'Classic';
    const type = cell === 1 ? 'X' : 'O';
    return `/tres_en_raya/${type}_${pattern}.svg`;
  }

  pieceStyle(cell: number): { [key: string]: string } {
    const color = this.cellColor(cell);
    const url = this.cellPieceUrl(cell);
    return {
      'background-color': color,
      'mask-image': `url(${url})`,
      '-webkit-mask-image': `url(${url})`,
    };
  }

  cellStyle(row: number, col: number): { [key: string]: string } {
    const cell = this.board[row]?.[col] ?? 0;
    if (cell === 0) return {};
    const color = this.cellColor(cell);
    return {
      '--cell-color': color,
      'border-color': color,
      'background': `color-mix(in srgb, ${color} 10%, transparent)`,
    };
  }

  cellClass(row: number, col: number): string {
    const v = this.board[row]?.[col] ?? 0;
    if (v !== 0) {
      if (this.isWinningCell(row, col)) return 'cell filled winning';
      return this.isVanishing(row, col) ? 'cell filled vanishing' : 'cell filled';
    }
    if (this.canPlay(row, col)) return 'cell playable';
    return 'cell';
  }

  /** True only for the piece that vanishes on the *very next* move — the
   *  oldest piece of whoever's turn it currently is (not both players' oldest
   *  at once, since only the player about to move can trigger a removal).
   *  Never applies once the match has ended — there is no "next move". */
  isVanishing(row: number, col: number): boolean {
    if (this.isTerminal()) return false;
    const uid: string = this.gameState?.current_turn ?? '';
    const queues: Record<string, number[][]> = this.gameState?.piece_queues ?? {};
    const queue = queues[uid] ?? [];
    if (queue.length < this.MAX_PIECES) return false;
    const [oldestRow, oldestCol] = queue[0];
    return oldestRow === row && oldestCol === col;
  }

  /** True for each of the 3 cells forming the winner's line, once the match is over. */
  isWinningCell(row: number, col: number): boolean {
    const line: number[][] | null = this.gameState?.winning_line ?? null;
    if (!line) return false;
    return line.some(([r, c]) => r === row && c === col);
  }
}
