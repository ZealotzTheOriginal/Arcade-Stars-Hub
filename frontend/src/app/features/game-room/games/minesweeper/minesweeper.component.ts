import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-minesweeper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './minesweeper.component.html',
  styleUrls: ['./minesweeper.component.scss'],
})
export class MinesweeperComponent {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Output() moveMade = new EventEmitter<{ row: number; col: number; action: string }>();

  get rows(): number { return this.gameState?.rows ?? 9; }
  get cols(): number { return this.gameState?.cols ?? 9; }
  get rowRange(): number[] { return Array.from({ length: this.rows }, (_, i) => i); }
  get colRange(): number[] { return Array.from({ length: this.cols }, (_, i) => i); }

  get isMyTurn(): boolean {
    return this.gameState?.current_turn === this.myUid;
  }

  isRevealed(r: number, c: number): boolean {
    return this.gameState?.revealed?.[r]?.[c] ?? false;
  }

  isFlagged(r: number, c: number): boolean {
    return this.gameState?.flagged?.[r]?.[c] ?? false;
  }

  cellValue(r: number, c: number): number {
    return this.gameState?.board?.[r]?.[c] ?? -2;
  }

  cellLabel(r: number, c: number): string {
    if (!this.isRevealed(r, c)) return this.isFlagged(r, c) ? '🚩' : '';
    const v = this.cellValue(r, c);
    if (v === -1) return '💥';
    if (v === 0) return '';
    return v.toString();
  }

  cellClass(r: number, c: number): string {
    if (!this.isRevealed(r, c)) {
      return 'cell hidden' + (this.isMyTurn && !this.gameState?.game_over ? ' playable' : '');
    }
    const v = this.cellValue(r, c);
    if (v === -1) return 'cell revealed mine';
    return `cell revealed n${v}`;
  }

  reveal(r: number, c: number) {
    if (!this.isMyTurn || this.isRevealed(r, c) || this.gameState?.game_over) return;
    this.moveMade.emit({ row: r, col: c, action: 'reveal' });
  }

  flag(e: MouseEvent, r: number, c: number) {
    e.preventDefault();
    if (!this.isMyTurn || this.isRevealed(r, c) || this.gameState?.game_over) return;
    this.moveMade.emit({ row: r, col: c, action: 'flag' });
  }
}
