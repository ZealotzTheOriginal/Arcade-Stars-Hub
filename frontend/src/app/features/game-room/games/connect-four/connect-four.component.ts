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
  @Output() moveMade = new EventEmitter<number>();

  readonly cols = Array.from({ length: 7 }, (_, i) => i);
  hoveredCol: number | null = null;

  get board(): number[][] {
    return this.gameState?.board ?? [];
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
    if (cell === 1) classes.push('p1');
    if (cell === 2) classes.push('p2');
    if (this.hoveredCol === col && this.isMyTurn && !this.isTerminal()) classes.push('hover');
    return classes.join(' ');
  }
}
