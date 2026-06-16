import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ai-slots',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-slots.component.html',
  styleUrls: ['./ai-slots.component.scss'],
})
export class AiSlotsComponent implements OnInit, OnDestroy {
  digits = signal<string[]>(['0', '0', '0', '0']);

  private timer?: ReturnType<typeof setInterval>;
  private tick = 0;
  private phase: 'random' | 'filling' | 'hold' | 'unfilling' = 'random';

  // Tick budgets (interval = 80 ms)
  private readonly RANDOM_TICKS    = 40; // 3.2 s  spinning
  private readonly FILL_STEP_TICKS  = 5; // 400 ms per digit lock   (left → right → 9999)
  private readonly HOLD_TICKS       = 8; // 640 ms holding 9999
  private readonly UNFILL_STEP_TICKS = 3; // 240 ms per digit unlock (left → right → XXXX, faster)

  ngOnInit() {
    this.digits.set(this._rand());
    this.timer = setInterval(() => this._step(), 80);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  private _step() {
    this.tick++;

    if (this.phase === 'random') {
      this.digits.set(this._rand());
      if (this.tick >= this.RANDOM_TICKS) {
        this.phase = 'filling';
        this.tick = 0;
      }

    } else if (this.phase === 'filling') {
      const locked = Math.floor(this.tick / this.FILL_STEP_TICKS);
      const next = this._rand();
      for (let i = 0; i < locked && i < 4; i++) next[i] = '9';
      this.digits.set(next);

      if (locked >= 4) {
        this.digits.set(['9', '9', '9', '9']);
        this.phase = 'hold';
        this.tick = 0;
      }

    } else if (this.phase === 'hold') {
      if (this.tick >= this.HOLD_TICKS) {
        this.phase = 'unfilling';
        this.tick = 0;
      }

    } else {
      // unfilling: unlock digits left-to-right back to random (X999 → XX99 → XXX9 → XXXX)
      const unlocked = Math.floor(this.tick / this.UNFILL_STEP_TICKS);
      const next: string[] = ['9', '9', '9', '9'];
      for (let i = 0; i < unlocked && i < 4; i++) next[i] = this._randDigit();
      this.digits.set(next);

      if (unlocked >= 4) {
        this.phase = 'random';
        this.tick = 0;
      }
    }
  }

  private _rand(): string[] {
    return Array.from({ length: 4 }, () => this._randDigit());
  }

  private _randDigit(): string {
    return String(Math.floor(Math.random() * 10));
  }
}
