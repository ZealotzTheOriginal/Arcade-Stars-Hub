import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerInfo } from '../../../core/models/game.model';
import { AiSlotsComponent } from '../ai-slots/ai-slots.component';

@Component({
  selector: 'app-hud',
  standalone: true,
  imports: [CommonModule, AiSlotsComponent],
  templateUrl: './hud.component.html',
  styleUrls: ['./hud.component.scss'],
})
export class HudComponent {
  @Input() players: PlayerInfo[] = [];
  @Input() scores: Record<string, number> = {};
  @Input() currentTurn: string = '';
  @Input() myUid: string = '';
  @Input() level: number = 1;
  @Input() elapsedSeconds: number = 0;
  @Input() status: string = 'waiting';
  @Input() roomCode: string = '';

  copyCode() {
    if (this.roomCode) navigator.clipboard.writeText(this.roomCode).catch(() => {});
  }

  get formattedTime(): string {
    const m = Math.floor(this.elapsedSeconds / 60).toString().padStart(2, '0');
    const s = (this.elapsedSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}
