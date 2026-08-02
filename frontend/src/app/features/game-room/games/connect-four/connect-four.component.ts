import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-connect-four',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './connect-four.component.html',
  styleUrls: ['./connect-four.component.scss'],
})
export class ConnectFourComponent {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
  @Input() chipPatterns: Partial<Record<string, string>> = {};
  @Input() gameMode: 'ffa' | 'teams' = 'ffa';
  @Input() teams: { a: string[]; b: string[] } = { a: [], b: [] };
  @Output() moveMade = new EventEmitter<number>();

  readonly cols = Array.from({ length: 7 }, (_, i) => i);
  hoveredCol: number | null = null;

  get board(): number[][] { return this.gameState?.board ?? []; }
  get isMyTurn(): boolean { return this.gameState?.current_turn === this.myUid; }

  isTerminal(): boolean { return !!this.gameState?.winner || !!this.gameState?.draw; }

  canDrop(col: number): boolean {
    if (!this.isMyTurn || this.isTerminal()) return false;
    return this.board[0]?.[col] === 0;
  }

  drop(col: number) { if (this.canDrop(col)) this.moveMade.emit(col); }

  isWinCell(row: number, col: number): boolean {
    const cells: number[][] = this.gameState?.win_cells ?? [];
    return cells.some(([r, c]) => r === row && c === col);
  }

  cellClass(row: number, col: number): string {
    const cell = this.board[row]?.[col] ?? 0;
    const classes = ['cell'];
    if (cell !== 0) classes.push('filled');
    if (this.isWinCell(row, col)) classes.push('win');
    if (this.isAboveLanding(row, col)) classes.push('hover');
    return classes.join(' ');
  }

  /** Lowest empty row in a column — where the next chip would actually land. -1 if full. */
  private landingRow(col: number): number {
    return this.board.reduceRight((found, r, i) => found === -1 && r[col] === 0 ? i : found, -1);
  }

  /** True only for empty cells strictly above the landing spot — the path the
   *  dropped chip would fall through. Excludes the landing cell itself and
   *  anything below it (already filled or out of reach for this drop). */
  private isAboveLanding(row: number, col: number): boolean {
    if (this.hoveredCol !== col || !this.isMyTurn || this.isTerminal()) return false;
    const landing = this.landingRow(col);
    if (landing === -1) return false;
    return row < landing;
  }

  get isWinner(): boolean {
    const winner = this.gameState?.winner;
    if (!winner || !this.myUid) return false;
    if (winner === this.myUid) return true;
    if (this.gameMode === 'teams') {
      const myTeam  = this.teams.a?.includes(this.myUid) ? 'a' : this.teams.b?.includes(this.myUid) ? 'b' : null;
      const winTeam = this.teams.a?.includes(winner)     ? 'a' : this.teams.b?.includes(winner)     ? 'b' : null;
      return myTeam !== null && winTeam === myTeam;
    }
    return false;
  }

  // ── Chip design ─────────────────────────────────────────
  // Reuses the same circular "O" piece artwork as tic-tac-toe so players can
  // pick a design once (per-game preference) instead of a fixed chip_N.svg.

  private uidForCell(cell: number): string {
    const players: string[] = this.gameState?.players ?? [];
    return players[cell - 1] ?? '';
  }

  private patternForUid(uid: string): string {
    return this.chipPatterns[uid] ?? 'Classic';
  }

  chipUrl(row: number, col: number): string {
    const cell = this.board[row]?.[col] ?? 0;
    if (!cell) return '';
    return `/tres_en_raya/O_${this.patternForUid(this.uidForCell(cell))}.svg`;
  }

  get nextChipUrl(): string {
    const uid = this.gameState?.current_turn ?? '';
    return `/tres_en_raya/O_${this.patternForUid(uid)}.svg`;
  }

  cellStyle(row: number, col: number): { [key: string]: string } {
    const cell = this.board[row]?.[col] ?? 0;
    if (cell === 0) return {};

    const players: string[] = this.gameState?.players ?? [];
    const uid = players[cell - 1];
    if (!uid) return {};

    const colors = this._chipColors(uid);
    const url    = this.chipUrl(row, col);

    return {
      background:               this._chipBackground(colors),
      'border-color':           'transparent',
      'border-radius':          '0',
      'mask-image':             `url(${url})`,
      '-webkit-mask-image':     `url(${url})`,
      'mask-size':              'contain',
      '-webkit-mask-size':      'contain',
      'mask-repeat':            'no-repeat',
      '-webkit-mask-repeat':    'no-repeat',
      'mask-position':          'center',
      '-webkit-mask-position':  'center',
      'filter':                 this.isWinCell(row, col)
                                ? `drop-shadow(0 0 12px ${colors[0]}) brightness(1.35)`
                                : `drop-shadow(0 0 6px ${colors[0]}99)`,
    };
  }

  // Hover indicator shows faint next chip shape in the lowest free cell
  hoverCellStyle(row: number, col: number): { [key: string]: string } {
    if (this.hoveredCol !== col || !this.isMyTurn || this.isTerminal()) return {};
    const cell = this.board[row]?.[col] ?? 0;
    if (cell !== 0) return {};
    if (row !== this.landingRow(col)) return {};

    const uid    = this.gameState?.current_turn;
    const color  = this.playerColors[uid] ?? '#888';
    const url    = this.nextChipUrl;
    return {
      'mask-image':             `url(${url})`,
      '-webkit-mask-image':     `url(${url})`,
      'mask-size':              'contain',
      '-webkit-mask-size':      'contain',
      'mask-repeat':            'no-repeat',
      '-webkit-mask-repeat':    'no-repeat',
      'mask-position':          'center',
      '-webkit-mask-position':  'center',
      'background-color':       color,
      'opacity':                '0.35',
      'border-radius':          '0',
    };
  }

  private _chipColors(uid: string): string[] {
    const base = this.playerColors[uid] ?? '#888888';
    if (this.gameMode !== 'teams') return [base];

    let teamMembers: string[] = [];
    if (this.teams.a?.includes(uid))      teamMembers = this.teams.a;
    else if (this.teams.b?.includes(uid)) teamMembers = this.teams.b;
    else return [base];

    const colors = [...new Set(
      teamMembers.map(m => this.playerColors[m]).filter((c): c is string => c !== undefined)
    )];
    return colors.length > 0 ? colors : [base];
  }

  private _chipBackground(colors: string[]): string {
    if (colors.length === 1) return colors[0];
    return `conic-gradient(from 225deg at 50% 50%, ${colors[0]} 0deg 90deg, ${colors[1]} 90deg 270deg, ${colors[0]} 270deg 360deg)`;
  }
}
