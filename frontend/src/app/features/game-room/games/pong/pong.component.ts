import {
  Component, Input, Output, EventEmitter,
  OnChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';

const W = 800, H = 500;
const PADDLE_W = 14, PADDLE_H = 90;
const PADDLE_MARGIN = 24;
const BALL_SIZE = 20;
const BALL_RADIUS = BALL_SIZE / 2;
const TICK_MS = 1000 / 30;
const WIN_SCORE = 15;
const RAINBOW_THRESHOLD = 13;

@Component({
  selector: 'app-pong',
  standalone: true,
  templateUrl: './pong.component.html',
  styleUrls: ['./pong.component.scss'],
})
export class PongComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
  @Output() paddleAction = new EventEmitter<{ action: string; direction: string | null }>();

  @ViewChild('canvasEl') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly W = W;
  readonly H = H;

  private ctx!: CanvasRenderingContext2D;
  private animId?: number;
  private lastState: any = null;
  private lastUpdateMs = 0;
  private currentDir: string | null = null;
  private prevScores: Record<string, number> = {};
  private flashTimes: Record<string, number> = {};

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    canvas.focus();
    this.zone.runOutsideAngular(() => this.loop());
  }

  ngOnChanges() {
    const state = this.gameState;
    if (state?.scores) {
      for (const uid of Object.keys(state.scores)) {
        const newScore: number = state.scores[uid] ?? 0;
        if (newScore > (this.prevScores[uid] ?? 0)) {
          this.flashTimes[uid] = performance.now();
        }
      }
      this.prevScores = { ...state.scores };
    }
    this.lastState = state;
    this.lastUpdateMs = performance.now();
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  // ── Keyboard ──────────────────────────────────────────────────

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (!this.myUid) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    let dir: string | null = null;
    if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') dir = 'up';
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dir = 'down';
    if (!dir) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (dir !== this.currentDir) {
      this.currentDir = dir;
      this.zone.run(() => this.paddleAction.emit({ action: 'start', direction: dir }));
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    if (!this.myUid) return;
    const isDir = ['ArrowUp','ArrowDown','w','W','s','S'].includes(e.key);
    if (isDir && this.currentDir) {
      this.currentDir = null;
      this.zone.run(() => this.paddleAction.emit({ action: 'stop', direction: null }));
    }
  }

  // ── Render loop ───────────────────────────────────────────────

  private loop() {
    this.draw();
    this.animId = requestAnimationFrame(() => this.loop());
  }

  private draw() {
    const state = this.lastState;
    if (!state || !this.ctx) return;

    const ctx = this.ctx;
    const now = performance.now();
    const elapsed = now - this.lastUpdateMs;          // ms since last server state
    const t = Math.min(elapsed / TICK_MS, 1.5);       // normalised ticks elapsed

    const ball = state.ball ?? {};
    const serving = (ball.serve ?? 0) > 0;

    // Interpolate ball position
    let bx = ball.x ?? W / 2 - BALL_SIZE / 2;
    let by = ball.y ?? H / 2 - BALL_SIZE / 2;
    if (!serving) {
      bx = Math.max(0, Math.min(W - BALL_SIZE, bx + (ball.vx ?? 0) * t));
      by = Math.max(0, Math.min(H - BALL_SIZE, by + (ball.vy ?? 0) * t));
    }

    // ── Background ────────────────────────────────────────────
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, W, H);

    // ── Score setup + big half-court ambient/flash scores ─────
    const players: string[] = state.players ?? [];
    const scores: Record<string, number> = state.scores ?? {};
    const p0 = players[0];
    const p1 = players[1];
    const col0 = (this.playerColors[p0] ?? '#ffffff') as string;
    const col1 = (this.playerColors[p1] ?? '#ffffff') as string;

    const FLASH_HOLD = 600, FLASH_FADE = 1600;
    for (const [uid, cx, col] of [[p0, W / 4, col0], [p1, W * 3 / 4, col1]] as [string, number, string][]) {
      const fAge = this.flashTimes[uid] != null ? now - this.flashTimes[uid] : Infinity;
      const alpha = fAge < FLASH_HOLD ? 0.82
        : fAge < FLASH_HOLD + FLASH_FADE ? 0.82 - ((fAge - FLASH_HOLD) / FLASH_FADE) * 0.77
        : 0.05;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '200px Impact, "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.fillText(String(scores[uid] ?? 0), cx, H / 2);
      ctx.restore();
    }

    // ── Paddles ────────────────────────────────────────────────
    const paddles: Record<string, any> = state.paddles ?? {};

    this.drawPaddle(ctx, PADDLE_MARGIN, paddles[p0]?.y ?? H / 2 - PADDLE_H / 2, col0);
    this.drawPaddle(ctx, W - PADDLE_MARGIN - PADDLE_W, paddles[p1]?.y ?? H / 2 - PADDLE_H / 2, col1);

    // ── Ball ──────────────────────────────────────────────────
    const cx = bx + BALL_RADIUS;
    const cy = by + BALL_RADIUS;
    const isRainbow = !serving && (ball.speed ?? 0) >= RAINBOW_THRESHOLD;

    if (serving) {
      const pulse = 0.45 + 0.55 * Math.sin(now / 180);
      ctx.globalAlpha = pulse;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    if (isRainbow) {
      const hue = (now / 6) % 360;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, BALL_RADIUS);
      grad.addColorStop(0,   `hsl(${hue}, 100%, 88%)`);
      grad.addColorStop(0.5, `hsl(${(hue + 120) % 360}, 100%, 65%)`);
      grad.addColorStop(1,   `hsl(${(hue + 240) % 360}, 100%, 52%)`);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillRect(cx - BALL_RADIUS, cy - BALL_RADIUS, BALL_SIZE, BALL_SIZE);
    ctx.restore();

    if (serving) ctx.globalAlpha = 1;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.fillStyle = color;
    const r = 5;
    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(x, y, PADDLE_W, PADDLE_H, r);
    } else {
      ctx.rect(x, y, PADDLE_W, PADDLE_H);
    }
    ctx.fill();
  }

  // ── Side helper (used in template) ────────────────────────────
  myPaddleSide(): string {
    if (!this.lastState || !this.myUid) return '';
    return this.lastState.paddles?.[this.myUid]?.side ?? '';
  }
}
