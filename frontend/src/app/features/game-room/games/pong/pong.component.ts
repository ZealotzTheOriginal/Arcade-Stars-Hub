import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';

// ── Canvas constants (must match backend px/s model) ──────────────────────────
const W = 800, H = 500;
const PADDLE_W = 14, PADDLE_H = 90;
const PADDLE_MARGIN = 24;
const BALL_SIZE   = 20;
const BALL_RADIUS = BALL_SIZE / 2;

const PADDLE_SPEED       = 240;   // px/s
const INITIAL_SPEED      = 300;   // px/s
const MAX_SPEED          = 600;   // px/s
const WALL_SPEED_INC     =   9;   // px/s per wall bounce
const RAINBOW_THRESHOLD  = 390;   // px/s (≈ 13 px/tick × 30)
const SERVE_MS           = 667;

// Flash-score animation timings
const FLASH_HOLD = 600, FLASH_FADE = 1600;

@Component({
  selector: 'app-pong',
  standalone: true,
  templateUrl: './pong.component.html',
  styleUrls: ['./pong.component.scss'],
})
export class PongComponent implements OnChanges, AfterViewInit, OnDestroy {
  // ── Inputs ──────────────────────────────────────────────
  @Input() myUid        = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
  @Input() pongTraj:    any    = null;   // trajectory packet from server
  @Input() scores:      Record<string, number> = {};
  @Input() players:     string[] = [];
  @Input() mySide:      string   = 'left';   // 'left' | 'right'
  @Input() opponentDir: string | null = null; // opponent key direction (human only)
  @Input() isOpponentAI = false;             // true → animate opponent paddle via physics

  // ── Outputs ─────────────────────────────────────────────
  @Output() pongHit  = new EventEmitter<{ hit_pos: number; paddle_dir: string | null; ball_y: number; speed: number }>();
  @Output() pongMiss = new EventEmitter<void>();
  @Output() paddleMove = new EventEmitter<string | null>(); // null = released

  @ViewChild('canvasEl') canvasRef!: ElementRef<HTMLCanvasElement>;
  readonly W = W;
  readonly H = H;

  private ctx!: CanvasRenderingContext2D;
  private animId?: number;

  // Local paddle state (px from top)
  private myPaddleY = H / 2 - PADDLE_H / 2;
  private opPaddleY = H / 2 - PADDLE_H / 2;

  private currentDir: string | null = null; // my key held
  private opArrivalY: number | null = null; // AI: predicted paddle intercept Y

  // Trajectory tracking
  private currentTraj: any = null;
  private trajId = 0;         // incremented on each new traj, detects changes
  private hitSent  = false;   // guard: one hit/miss per trajectory
  private lastFrameMs = 0;

  // Score flash
  private prevScores: Record<string, number> = {};
  private flashTimes: Record<string, number> = {};

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    canvas.focus();
    // Apply trajectory that may have arrived before the component mounted
    if (this.pongTraj) {
      this.currentTraj = this.pongTraj;
      this.hitSent = false;
    }
    this.zone.runOutsideAngular(() => this.loop());
  }

  ngOnChanges(changes: SimpleChanges) {
    // New trajectory from server
    if (changes['pongTraj'] && this.pongTraj) {
      this.currentTraj = this.pongTraj;
      this.trajId++;
      this.hitSent = false;

      if (this.isOpponentAI && !this.pongTraj.serving) {
        const opSide = this.mySide === 'left' ? 'right' : 'left';
        const ballToOp = opSide === 'left' ? this.pongTraj.vx < 0 : this.pongTraj.vx > 0;
        this.opArrivalY = ballToOp ? this.predictOpponentArrival() : null;
      }
    }

    // Score flash detection
    if (changes['scores'] && this.scores) {
      for (const uid of Object.keys(this.scores)) {
        if ((this.scores[uid] ?? 0) > (this.prevScores[uid] ?? 0)) {
          this.flashTimes[uid] = performance.now();
        }
      }
      this.prevScores = { ...this.scores };
    }
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  // ── Keyboard ─────────────────────────────────────────────

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
      this.zone.run(() => this.paddleMove.emit(dir));
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    if (!this.myUid) return;
    if (['ArrowUp','ArrowDown','w','W','s','S'].includes(e.key) && this.currentDir) {
      this.currentDir = null;
      this.zone.run(() => this.paddleMove.emit(null));
    }
  }

  // Called by game-room to get current paddle Y for position sync
  getMyPaddleY(): number { return this.myPaddleY; }

  // Predict where the ball will reach the opponent's paddle face (for AI animation)
  private predictOpponentArrival(): number {
    const traj = this.currentTraj;
    if (!traj) return this.opPaddleY;
    const opSide = this.mySide === 'left' ? 'right' : 'left';
    const targetX = opSide === 'left'
      ? PADDLE_MARGIN + PADDLE_W
      : W - PADDLE_MARGIN - PADDLE_W - BALL_SIZE;

    const t = (targetX - traj.x) / traj.vx;
    if (t <= 0) return this.opPaddleY;

    let y = traj.y, vy = traj.vy, speed = traj.speed, remaining = t;
    while (remaining > 0.0001) {
      const t_top  = vy < 0 ? -y / vy                : Infinity;
      const t_bot  = vy > 0 ? (H - BALL_SIZE - y) / vy : Infinity;
      const t_wall = Math.min(t_top, t_bot);
      if (t_wall > 0 && t_wall < remaining) {
        y += vy * t_wall;
        y = vy < 0 ? 0 : H - BALL_SIZE;
        speed = Math.min(speed + WALL_SPEED_INC, MAX_SPEED);
        const mag = Math.abs(vy) * 0.80;
        vy = vy < 0 ? mag : -mag;
        remaining -= t_wall;
      } else {
        y += vy * remaining;
        remaining = 0;
      }
    }
    return Math.max(0, Math.min(H - PADDLE_H, y - PADDLE_H / 2));
  }

  // ── Render loop ──────────────────────────────────────────

  private loop() {
    const now = performance.now();
    const dt  = this.lastFrameMs ? (now - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = now;

    this.movePaddles(dt);
    this.draw(now);
    this.animId = requestAnimationFrame(() => this.loop());
  }

  // ── Paddle simulation ─────────────────────────────────────

  private movePaddles(dt: number) {
    // My paddle
    if (this.currentDir === 'up') {
      this.myPaddleY = Math.max(0, this.myPaddleY - PADDLE_SPEED * dt);
    } else if (this.currentDir === 'down') {
      this.myPaddleY = Math.min(H - PADDLE_H, this.myPaddleY + PADDLE_SPEED * dt);
    }

    // Opponent paddle: human relay takes priority; fall back to AI prediction
    if (this.opponentDir === 'up') {
      this.opPaddleY = Math.max(0, this.opPaddleY - PADDLE_SPEED * dt);
    } else if (this.opponentDir === 'down') {
      this.opPaddleY = Math.min(H - PADDLE_H, this.opPaddleY + PADDLE_SPEED * dt);
    } else if (this.isOpponentAI && this.opArrivalY !== null) {
      const diff = this.opArrivalY - this.opPaddleY;
      const step = PADDLE_SPEED * dt;
      this.opPaddleY = Math.abs(diff) <= step
        ? this.opArrivalY
        : this.opPaddleY + Math.sign(diff) * step;
    }
  }

  // ── Ball extrapolation (client-side physics) ──────────────

  private extrapolateBall(now: number): { x: number; y: number; vx: number; vy: number; speed: number; serving: boolean } {
    const traj = this.currentTraj;
    if (!traj) return { x: W / 2 - BALL_RADIUS, y: H / 2 - BALL_RADIUS, vx: 0, vy: 0, speed: 0, serving: true };

    const elapsed  = now - traj.ts;                // ms since trajectory received
    const serveMs  = traj.serving ? (traj.serve_ms ?? SERVE_MS) : 0;

    if (elapsed < serveMs) {
      return { x: traj.x, y: traj.y, vx: traj.vx, vy: traj.vy, speed: traj.speed, serving: true };
    }

    let dt    = (elapsed - serveMs) / 1000; // seconds of actual motion
    let x     = traj.x, y = traj.y;
    let vx    = traj.vx, vy = traj.vy;
    let speed = traj.speed;

    // Simulate wall bounces deterministically (same math as server)
    while (dt > 0.0001) {
      const t_top = vy < 0 ? -y / vy            : Infinity;
      const t_bot = vy > 0 ? (H - BALL_SIZE - y) / vy : Infinity;
      const t_wall = Math.min(t_top, t_bot);

      if (t_wall > 0 && t_wall < dt) {
        x += vx * t_wall;
        y += vy * t_wall;
        y = vy < 0 ? 0 : H - BALL_SIZE;
        speed = Math.min(speed + WALL_SPEED_INC, MAX_SPEED);
        const vy_mag = Math.abs(vy) * 0.80;
        vx = Math.sign(vx) * Math.sqrt(Math.max(speed ** 2 - vy_mag ** 2, 1));
        vy = vy < 0 ? vy_mag : -vy_mag;
        dt -= t_wall;
      } else {
        x += vx * dt;
        y += vy * dt;
        dt  = 0;
      }
    }

    return { x, y, vx, vy, speed, serving: false };
  }

  // ── Hit / miss detection ──────────────────────────────────

  private checkHitMiss(ball: { x: number; y: number; vx: number; vy: number; speed: number; serving: boolean }) {
    if (ball.serving || this.hitSent || !this.myUid || !this.currentTraj) return;

    const approachingMe = this.mySide === 'left' ? ball.vx < 0 : ball.vx > 0;
    if (!approachingMe) return;

    const paddleFaceX = this.mySide === 'left'
      ? PADDLE_MARGIN + PADDLE_W
      : W - PADDLE_MARGIN - PADDLE_W;

    const reached = this.mySide === 'left'
      ? ball.x <= paddleFaceX
      : ball.x + BALL_SIZE >= paddleFaceX;

    if (!reached) return;

    this.hitSent = true;

    if (ball.y + BALL_SIZE > this.myPaddleY && ball.y < this.myPaddleY + PADDLE_H) {
      const hitPos = (ball.y + BALL_SIZE / 2 - this.myPaddleY) / PADDLE_H;
      this.zone.run(() => this.pongHit.emit({
        hit_pos:    Math.max(0, Math.min(1, hitPos)),
        paddle_dir: this.currentDir,
        ball_y:     ball.y,
        speed:      ball.speed,
      }));
    } else {
      this.zone.run(() => this.pongMiss.emit());
    }
  }

  // ── Draw ──────────────────────────────────────────────────

  private draw(now: number) {
    if (!this.ctx) return;
    const ctx  = this.ctx;
    const ball = this.extrapolateBall(now);

    this.checkHitMiss(ball);

    const p0   = this.players[0] ?? '';
    const p1   = this.players[1] ?? '';
    const col0 = (this.playerColors[p0] ?? '#ffffff') as string;
    const col1 = (this.playerColors[p1] ?? '#ffffff') as string;

    const leftPaddleY  = this.mySide === 'left'  ? this.myPaddleY : this.opPaddleY;
    const rightPaddleY = this.mySide === 'right' ? this.myPaddleY : this.opPaddleY;

    // Background
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, W, H);

    // Ambient half-court scores
    for (const [uid, cx, col] of [[p0, W / 4, col0], [p1, W * 3 / 4, col1]] as [string, number, string][]) {
      const fAge  = this.flashTimes[uid] != null ? now - this.flashTimes[uid] : Infinity;
      const alpha = fAge < FLASH_HOLD ? 0.82
        : fAge < FLASH_HOLD + FLASH_FADE
          ? 0.82 - ((fAge - FLASH_HOLD) / FLASH_FADE) * 0.77
          : 0.05;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font        = '200px Impact, "Arial Black", Arial, sans-serif';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle   = col;
      ctx.fillText(String(this.scores[uid] ?? 0), cx, H / 2);
      ctx.restore();
    }

    // Paddles
    this.drawPaddle(ctx, PADDLE_MARGIN,               leftPaddleY,  col0);
    this.drawPaddle(ctx, W - PADDLE_MARGIN - PADDLE_W, rightPaddleY, col1);

    // Ball
    const cx = ball.x + BALL_RADIUS;
    const cy = ball.y + BALL_RADIUS;
    const isRainbow = !ball.serving && ball.speed >= RAINBOW_THRESHOLD;

    if (ball.serving) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.sin(now / 180);
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, BALL_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    if (isRainbow) {
      const hue  = (now / 6) % 360;
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

    if (ball.serving) ctx.globalAlpha = 1;

    ctx.textAlign   = 'left';
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
}
