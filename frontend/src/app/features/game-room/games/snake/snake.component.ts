import {
  Component, Input, Output, EventEmitter,
  OnChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

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
  imports: [TranslatePipe],
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

  // Uids that respawned (lives mode) on the CURRENT state — their body was
  // teleported to a corner, so head/tail interpolation must snap instead of
  // sliding across the whole board.
  private respawnedUids = new Set<string>();

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
    const bgComponent = getComputedStyle(document.documentElement).getPropertyValue('--bg-component').trim();
    ctx.fillStyle = bgComponent || '#15151d';
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

    this.respawnedUids = new Set(
      Object.entries(this.gameState?.snakes ?? {})
        .filter(([, s]: [string, any]) => s?.respawned_this_tick)
        .map(([uid]) => uid)
    );

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
        ctx.fillStyle = `hsl(${hue}, 100%, 62%)`;
      } else {
        ctx.fillStyle = '#ffffff';
      }
      this.drawStar(ctx, cx, cy, 8, S * 0.36, S * 0.15);
    }

    for (const uid of (state.players ?? [])) {
      const snake = state.snakes?.[uid];
      if (!snake) continue;
      const body: number[][] = snake.body ?? [];
      if (body.length === 0) continue;

      const color      = (this.playerColors[uid] ?? '#888888') as string;
      const alpha      = snake.alive ? 1 : 0.28;
      const isMe       = uid === this.myUid;
      const dir        = snake.direction ?? 'right';
      const respawned  = this.respawnedUids.has(uid);
      const prev       = respawned ? null : (this.prevTailPos[uid] ?? null);

      const { headX, headY, eyeDir } = this.computeHead(body, dir, t, isMe, snake.alive, respawned);
      this.drawSnake(ctx, body, headX, headY, eyeDir, color, alpha, t, prev, snake.alive);
    }
  }

  private computeHead(
    body: number[][], serverDir: string, t: number,
    isMe: boolean, alive: boolean, justRespawned: boolean = false,
  ): { headX: number; headY: number; eyeDir: string } {
    const S = CELL;
    const [hr, hc] = body[0];

    if (!alive) {
      return { headX: (hc + 0.5) * S, headY: (hr + 0.5) * S, eyeDir: serverDir };
    }

    // Just teleported to a new corner — snap instead of sliding in from
    // wherever the body used to be.
    if (justRespawned && t <= 1) {
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
    t: number, prevTail: [number, number] | null, alive: boolean,
  ) {
    const S = CELL;
    const N = body.length;
    // Segments are rounded squares inscribed in each cell, bridged by plain
    // rects to the next segment — unlike a stroked path with round joins,
    // this never bulges past the cells the body actually occupies on turns.
    const segSize   = R * 2;
    const segRadius = segSize * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;

    const cellCenter = (i: number): [number, number] => {
      const [r, c] = body[i];
      return [(c + 0.5) * S, (r + 0.5) * S];
    };

    // Ordered chain of body-segment points, tail → head:
    // t ≤ 1: ends at body[1], then bridges straight to the sliding head
    // t > 1: also passes through body[0] before the extrapolated head tip
    const chain: [number, number][] = [];

    if (N > 1) {
      const [tailR, tailC] = body[N - 1];
      const newTailFixed: [number, number] = [(tailC + 0.5) * S, (tailR + 0.5) * S];

      // Retracting tip: slides from the OLD tail cell into the new (fixed)
      // tail cell as t goes 0→1. It only ever moves along the single axis
      // between two adjacent grid cells, so — unlike interpolating straight
      // to the next body segment — it stays axis-aligned even when the body
      // bends right at the tail, instead of cutting a diagonal shortcut.
      let retractTip: [number, number] | null = null;
      if (prevTail && t < 1) {
        const [pR, pC] = prevTail;
        if (pR !== tailR || pC !== tailC) {
          retractTip = [(pC + (tailC - pC) * t + 0.5) * S, (pR + (tailR - pR) * t + 0.5) * S];
        }
      }

      if (retractTip) chain.push(retractTip);
      chain.push(newTailFixed);
      for (let i = N - 2; i >= 1; i--) chain.push(cellCenter(i));
      if (t > 1) chain.push(cellCenter(0));
    }

    chain.push([headX, headY]);

    // Every square + bridge is added as a subpath of ONE path, filled with a
    // single fill() call. That matters once alpha < 1 (dead snakes): filling
    // each overlapping shape separately re-blends the alpha at every overlap,
    // which is what produced the checkered/gappy look on faded bodies.
    ctx.beginPath();
    for (let i = 1; i < chain.length; i++) {
      const [x1, y1] = chain[i - 1];
      const [x2, y2] = chain[i];
      this.addBridgePath(ctx, x1, y1, x2, y2, segSize);
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const [x, y] = chain[i];
      this.addRoundSquarePath(ctx, x, y, segSize, segRadius);
    }
    ctx.arc(headX, headY, R * 1.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Eyes are drawn at full opacity even on a faded (dead) body, so the
    // cartoon "X" death marker stays crisp instead of also washing out.
    ctx.save();
    this.drawEyes(ctx, headX, headY, eyeDir, R, alive);
    ctx.restore();
  }

  private addRoundSquarePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, r: number) {
    const half = size / 2;
    const x = cx - half, y = cy - half;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + size - r, y);
    ctx.arcTo(x + size, y, x + size, y + r, r);
    ctx.lineTo(x + size, y + size - r);
    ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
    ctx.lineTo(x + r, y + size);
    ctx.arcTo(x, y + size, x, y + size - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /** Straight rect bridging two adjacent (axis-aligned) segment centers, so
   *  consecutive rounded squares read as one continuous, ungapped body. */
  private addBridgePath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, thickness: number) {
    const half = thickness / 2;
    const left = Math.min(x1, x2) - half;
    const top  = Math.min(y1, y2) - half;
    const w    = Math.abs(x2 - x1) + thickness;
    const h    = Math.abs(y2 - y1) + thickness;
    ctx.rect(left, top, w, h);
  }

  private drawEyes(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, dir: string, headR: number, alive: boolean,
  ) {
    const fwdMap: Record<string, [number, number]> = {
      up:[0,-1], down:[0,1], left:[-1,0], right:[1,0],
    };
    const [fx, fy] = fwdMap[dir] ?? [1, 0];
    const px = -fy, py = fx;

    // Big, close-to-the-front cartoon eyes.
    const fwdOff  = headR * 0.30;
    const sideOff = headR * 0.46;
    const eyeR    = headR * 0.40;

    const eyes: [number, number][] = [
      [cx + fx * fwdOff + px * sideOff, cy + fy * fwdOff + py * sideOff],
      [cx + fx * fwdOff - px * sideOff, cy + fy * fwdOff - py * sideOff],
    ];

    if (!alive) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth    = eyeR * 0.5;
      ctx.lineCap      = 'round';
      const arm = eyeR * 0.85;
      for (const [ex, ey] of eyes) {
        ctx.beginPath();
        ctx.moveTo(ex - arm, ey - arm); ctx.lineTo(ex + arm, ey + arm);
        ctx.moveTo(ex + arm, ey - arm); ctx.lineTo(ex - arm, ey + arm);
        ctx.stroke();
      }
      return;
    }

    const pupilR = eyeR * 0.58;
    const pupFwd = pupilR * 0.35;

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
