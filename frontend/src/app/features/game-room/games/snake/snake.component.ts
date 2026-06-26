import {
  Component, Input, Output, EventEmitter,
  OnChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';

const CELL    = 64;
const BOARD   = 24;
const TICK_MS = 100;
const R       = CELL * 0.38;

const OPP: Record<string, string> = { up:'down', down:'up', left:'right', right:'left' };
const DIR_OFFSET: Record<string, [number, number]> = {
  up:[-1,0], down:[1,0], left:[0,-1], right:[0,1],
};

@Component({
  selector: 'app-snake',
  standalone: true,
  templateUrl: './snake.component.html',
  styleUrls: ['./snake.component.scss'],
})
export class SnakeComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() gameState: any = null;
  @Input() myUid: string = '';
  @Input() playerColors: Partial<Record<string, string>> = {};
  @Input() gameOver = false;
  @Output() directionChanged = new EventEmitter<string>();

  @ViewChild('canvasEl') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly CANVAS_PX = BOARD * CELL;

  private ctx!: CanvasRenderingContext2D;
  private animId?: number;
  private lastState: any = null;
  private tickTs = 0;

  // Input queue: mirrors server-side pending_dirs (max 3)
  private pendingDirs: string[] = [];
  private effectiveDir = 'right';

  // Tail position from the PREVIOUS server state, per uid.
  // Used to animate the tail smoothly from old position to new position each tick.
  private prevTailPos: Record<string, [number, number]> = {};

  private bgCanvas!: HTMLCanvasElement;

  constructor(private zone: NgZone) {}

  get isWaiting(): boolean {
    return !!this.myUid && !!this.lastState && this.lastState.tick === 0;
  }

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    canvas.focus();
    this.renderBackground();
    this.zone.runOutsideAngular(() => this.loop());
  }

  private renderBackground() {
    const S = CELL, N = BOARD;
    const bg = document.createElement('canvas');
    bg.width = bg.height = N * S;
    const ctx = bg.getContext('2d')!;
    ctx.fillStyle = '#0d0f18';
    ctx.fillRect(0, 0, N * S, N * S);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * S, 0); ctx.lineTo(i * S, N * S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * S); ctx.lineTo(N * S, i * S); ctx.stroke();
    }
    this.bgCanvas = bg;
  }

  ngOnChanges() {
    if (this.gameState === this.lastState) return;

    // Save tail positions from the CURRENT state before it becomes the previous one.
    // This lets drawSnake interpolate the tail from its old position to its new one.
    if (this.lastState?.snakes) {
      for (const uid of Object.keys(this.lastState.snakes)) {
        const body: number[][] = this.lastState.snakes[uid]?.body;
        if (body?.length) {
          this.prevTailPos[uid] = [body[body.length - 1][0], body[body.length - 1][1]];
        }
      }
    }

    if (this.gameState?.tick === 0) {
      this.pendingDirs  = [];
      this.prevTailPos  = {};
      this.effectiveDir = this.gameState?.snakes?.[this.myUid]?.direction ?? 'right';
    } else {
      if (this.pendingDirs.length > 0) this.pendingDirs.shift();
      const serverDir = this.gameState?.snakes?.[this.myUid]?.direction;
      this.effectiveDir = this.pendingDirs.length > 0
        ? this.pendingDirs[this.pendingDirs.length - 1]
        : (serverDir ?? this.effectiveDir);
    }

    // Game over: drain pending queue so effectiveDir stays clean
    if (this.gameOver) this.pendingDirs = [];

    this.tickTs    = performance.now();
    this.lastState = this.gameState;
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.myUid || this.gameOver) return;
    if (!this.lastState?.snakes?.[this.myUid]?.alive) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const map: Record<string, string> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();

    if (dir === OPP[this.effectiveDir]) return;
    if (this.pendingDirs.length > 0 && this.pendingDirs[this.pendingDirs.length - 1] === dir) return;
    if (this.pendingDirs.length >= 3) return;

    this.pendingDirs.push(dir);
    this.effectiveDir = dir;
    this.zone.run(() => this.directionChanged.emit(dir));
  }

  private loop() {
    const now = performance.now();
    this.draw(now);
    this.animId = requestAnimationFrame(() => this.loop());
  }

  private draw(now: number) {
    const state = this.lastState;
    if (!state || !this.ctx) return;

    const ctx = this.ctx;
    const S   = CELL;

    // t > 1 triggers extrapolation; clamp to 1 when game over so snakes freeze at final tick
    const rawT = (this.tickTs && state.tick > 0) ? (now - this.tickTs) / TICK_MS : 0;
    const t = this.gameOver ? Math.min(rawT, 1) : rawT;

    ctx.drawImage(this.bgCanvas, 0, 0);

    for (const food of (state.food ?? [])) {
      const cx = food.c * S + S / 2;
      const cy = food.r * S + S / 2;
      if (food.type === 'rainbow') {
        const hue = (now / 15) % 360;
        ctx.fillStyle   = `hsl(${hue}, 100%, 62%)`;
        ctx.shadowBlur  = 18;
        ctx.shadowColor = `hsl(${hue}, 100%, 62%)`;
      } else {
        ctx.fillStyle   = '#ffffff';
        ctx.shadowBlur  = 12;
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
      }
      this.drawStar(ctx, cx, cy, 8, S * 0.36, S * 0.15);
      ctx.shadowBlur = 0;
    }

    for (const uid of (state.players ?? [])) {
      const snake = state.snakes?.[uid];
      if (!snake) continue;
      const body: number[][] = snake.body ?? [];
      if (body.length === 0) continue;

      const color  = (this.playerColors[uid] ?? '#888888') as string;
      const alpha  = snake.alive ? 1 : 0.28;
      const isMe   = uid === this.myUid;
      const dir    = snake.direction ?? 'right';
      const prev   = this.prevTailPos[uid] ?? null;

      const { headX, headY, eyeDir } = this.computeHead(body, dir, t, isMe, snake.alive);
      this.drawSnake(ctx, body, headX, headY, eyeDir, color, alpha, t, prev);
    }

    if (this.gameOver) this.drawGameOver(ctx, state, now);
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, state: any, now: number) {
    const PX = BOARD * CELL;
    const winner: string | null = state.winner ?? null;

    // Dark vignette
    ctx.save();
    ctx.fillStyle = 'rgba(5, 5, 8, 0.55)';
    ctx.fillRect(0, 0, PX, PX);

    const cx = PX / 2;
    const cy = PX / 2;

    if (winner) {
      const color = (this.playerColors[winner] ?? '#ffffff') as string;
      const isMe  = winner === this.myUid;
      const label = isMe ? '¡Ganaste!' : '¡Perdiste!';

      // Pulsing glow ring
      const pulse = 0.85 + 0.15 * Math.sin(now / 280);
      ctx.shadowBlur  = 48 * pulse;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3 * pulse;
      ctx.beginPath();
      ctx.arc(cx, cy, 90 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Main label
      ctx.font      = 'bold 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.shadowBlur  = 20;
      ctx.shadowColor = color;
      ctx.fillText(label, cx, cy - 14);
      ctx.shadowBlur = 0;

      // Score sub-label
      const score = state.snakes?.[winner]?.score ?? 0;
      ctx.font      = '22px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(`${score} pt${score !== 1 ? 's' : ''}`, cx, cy + 34);
    } else {
      // Draw (all died on same tick)
      ctx.font      = 'bold 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('Empate', cx, cy);
    }

    ctx.restore();
  }

  private computeHead(
    body: number[][], serverDir: string, t: number,
    isMe: boolean, alive: boolean,
  ): { headX: number; headY: number; eyeDir: string } {
    const S = CELL;
    const [hr, hc] = body[0];

    if (!alive) {
      return { headX: (hc + 0.5) * S, headY: (hr + 0.5) * S, eyeDir: serverDir };
    }

    if (t <= 1) {
      if (body.length > 1) {
        const [nr, nc] = body[1];
        return {
          headX:  (nc + (hc - nc) * t + 0.5) * S,
          headY:  (nr + (hr - nr) * t + 0.5) * S,
          eyeDir: serverDir,
        };
      }
      return { headX: (hc + 0.5) * S, headY: (hr + 0.5) * S, eyeDir: serverDir };
    }

    // t > 1: predict next cell using local queue
    const nextDir = isMe ? (this.pendingDirs[0] ?? serverDir) : serverDir;
    const [dr, dc] = DIR_OFFSET[nextDir] ?? [0, 0];
    const predR = Math.max(0, Math.min(BOARD - 1, hr + dr));
    const predC = Math.max(0, Math.min(BOARD - 1, hc + dc));
    const tExtra = Math.min(t - 1, 1);
    return {
      headX:  (hc + (predC - hc) * tExtra + 0.5) * S,
      headY:  (hr + (predR - hr) * tExtra + 0.5) * S,
      eyeDir: nextDir,
    };
  }

  private drawSnake(
    ctx: CanvasRenderingContext2D,
    body: number[][], headX: number, headY: number,
    eyeDir: string, color: string, alpha: number,
    t: number, prevTail: [number, number] | null,
  ) {
    const S = CELL;
    const N = body.length;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = R * 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();

    // ── Tail start: animate from previous tail position to current tail ──
    // The tail retracts smoothly during t=0→1, just like the head advances.
    // When food was eaten the tail didn't move (prevTail === currentTail) → no animation.
    const [tailR, tailC] = body[N - 1];
    let tailStartX = (tailC + 0.5) * S;
    let tailStartY = (tailR + 0.5) * S;

    if (prevTail && t < 1) {
      const [pR, pC] = prevTail;
      if (pR !== tailR || pC !== tailC) {
        // Tail moved → interpolate from old position to new position
        tailStartX = (pC + (tailC - pC) * t + 0.5) * S;
        tailStartY = (pR + (tailR - pR) * t + 0.5) * S;
      }
    }

    ctx.moveTo(tailStartX, tailStartY);

    // ── Body ──────────────────────────────────────────────────────────
    // t ≤ 1: stroke ends between body[1] and body[0] (head slides out of neck)
    // t > 1: stroke passes through body[0] then continues to extrapolated head
    const stopIdx = t > 1 ? 0 : 1;
    for (let i = N - 2; i >= stopIdx; i--) {
      ctx.lineTo((body[i][1] + 0.5) * S, (body[i][0] + 0.5) * S);
    }
    if (N > 1) ctx.lineTo(headX, headY);

    ctx.stroke();

    // ── Head circle with glow ─────────────────────────────────────────
    ctx.fillStyle   = color;
    ctx.shadowBlur  = 16;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(headX, headY, R * 1.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    this.drawEyes(ctx, headX, headY, eyeDir, R);
    ctx.restore();
  }

  private drawEyes(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, dir: string, headR: number,
  ) {
    const fwdMap: Record<string, [number, number]> = {
      up:[0,-1], down:[0,1], left:[-1,0], right:[1,0],
    };
    const [fx, fy] = fwdMap[dir] ?? [1, 0];
    const px = -fy, py = fx;

    const fwdOff  = headR * 0.40;
    const sideOff = headR * 0.38;
    const eyeR    = headR * 0.22;
    const pupilR  = eyeR  * 0.55;
    const pupFwd  = pupilR * 0.35;

    const eyes: [number, number][] = [
      [cx + fx * fwdOff + px * sideOff, cy + fy * fwdOff + py * sideOff],
      [cx + fx * fwdOff - px * sideOff, cy + fy * fwdOff - py * sideOff],
    ];

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [ex, ey] of eyes) {
      ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#111827';
    for (const [ex, ey] of eyes) {
      ctx.beginPath();
      ctx.arc(ex + fx * pupFwd, ey + fy * pupFwd, pupilR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, spikes: number, outer: number, inner: number,
  ) {
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
      rot += step;
    }
    ctx.closePath();
    ctx.fill();
  }
}
