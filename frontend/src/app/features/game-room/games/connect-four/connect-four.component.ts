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

  get board(): number[][] {
    return this.gameState?.board ?? [];
  }

  get isMyTurn(): boolean {
    return this.gameState?.current_turn === this.myUid;
  }

  isTerminal(): boolean {
    return !!this.gameState?.winner || !!this.gameState?.draw;
  }

  canDrop(col: number): boolean {
    if (!this.isMyTurn || this.isTerminal()) return false;
    return this.board[0]?.[col] === 0;
  }

  drop(col: number) {
    if (this.canDrop(col)) this.moveMade.emit(col);
  }

  cellClass(row: number, col: number): string {
    const cell = this.board[row]?.[col] ?? 0;
    const classes = ['cell'];
    if (cell !== 0) classes.push('filled');
    if (this.hoveredCol === col && this.isMyTurn && !this.isTerminal()) classes.push('hover');
    return classes.join(' ');
  }

  cellStyle(row: number, col: number): { [key: string]: string } {
    const cell = this.board[row]?.[col] ?? 0;
    if (cell === 0) return {};

    const players: string[] = this.gameState?.players ?? [];
    const uid = players[cell - 1];
    if (!uid) return {};

    const colors = this._chipColors(uid);
    return {
      background: this._chipBackground(colors),
      'box-shadow': `0 0 10px ${colors[0]}99`,
      'border-color': 'transparent',
    };
  }

  private _chipColors(uid: string): string[] {
    const base = this.playerColors[uid] ?? '#888888';
    if (this.gameMode !== 'teams') return [base];

    let teamMembers: string[] = [];
    if (this.teams.a?.includes(uid)) teamMembers = this.teams.a;
    else if (this.teams.b?.includes(uid)) teamMembers = this.teams.b;
    else return [base];

    const colors = [...new Set(
      teamMembers.map(m => this.playerColors[m]).filter((c): c is string => c !== undefined)
    )];
    return colors.length > 0 ? colors : [base];
  }

  private _chipBackground(colors: string[]): string {
    const sheen = 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.28) 0%, transparent 65%)';
    if (colors.length === 1) {
      return `${sheen}, ${colors[0]}`;
    }
    // diagonal / cut: bottom-left = colors[0], top-right = colors[1]
    const split = `linear-gradient(45deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
    return `${sheen}, ${split}`;
  }
}
