import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-connect-four',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connect-four.component.html',
  styleUrls: ['./connect-four.component.scss'],
})
export class ConnectFourComponent {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
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
    if (this.hoveredCol === col && this.isMyTurn && !this.isTerminal()) classes.push('hover');
    return classes.join(' ');
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

  chipUrl(row: number, col: number): string {
    const cell = this.board[row]?.[col] ?? 0;
    return cell ? `/conecta_cuatro/chip_${cell}.svg` : '';
  }

  get nextChipUrl(): string {
    const players: string[] = this.gameState?.players ?? [];
    const uid = this.gameState?.current_turn;
    const idx = players.indexOf(uid);
    return `/conecta_cuatro/chip_${idx >= 0 ? idx + 1 : 1}.svg`;
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
    // Only apply to the lowest empty row in this column
    const board = this.board;
    const lastEmpty = board.reduceRight((found, r, i) => found === -1 && r[col] === 0 ? i : found, -1);
    if (row !== lastEmpty) return {};

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
