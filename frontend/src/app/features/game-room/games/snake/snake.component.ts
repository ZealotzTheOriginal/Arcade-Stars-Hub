import {
  Component, Input, Output, EventEmitter,
  OnChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';

const CELL  = 64;
const BOARD = 24;

// Sprite canonical orientations (all SVGs fill="white", tinted per player color):
//   HEAD / HEAD_2  → face points UP
//   TAIL           → tip DOWN, body connection TOP
//   BODY           → straight vertical (top ↔ bottom)
//   BODY_UP_RIGHT / BODY_DOWN_RIGHT / BODY_DOWN_LEFT / BODY_UP_LEFT → corners, no extra rotation

const SPRITE_NAMES = [
  'HEAD', 'HEAD_2', 'BODY',
  'BODY_UP_RIGHT', 'BODY_DOWN_RIGHT', 'BODY_DOWN_LEFT', 'BODY_UP_LEFT',
  'TAIL',
] as const;
type SpriteName = typeof SPRITE_NAMES[number];

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
  @Output() directionChanged = new EventEmitter<string>();

  @ViewChild('canvasEl') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly CANVAS_PX = BOARD * CELL;

  private ctx!: CanvasRenderingContext2D;
  private animId?: number;
  private lastState: any = null;

  // Pre-rendered static background (grid never changes)
  private bgCanvas!: HTMLCanvasElement;

  // Raw SVG images
  private sprites: Partial<Record<SpriteName, HTMLImageElement>> = {};

  // Cache: "color:spriteName:angleDeg" → pre-tinted bitmap canvas
  // Each entry is a tiny CELL×CELL canvas drawn exactly once, reused every frame.
  private spriteCache = new Map<string, HTMLCanvasElement>();

  private lastColorsStr = '';

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    canvas.focus();
    this.renderBackground();
    this.loadSprites();
    this.zone.runOutsideAngular(() => this.loop());
  }

  // ── Static background pre-render ─────────────────────────────
  // Called once. Grid lines never change so we blit this as a single
  // drawImage() instead of redrawing N² lines every frame.

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

  // ── Sprite loading ────────────────────────────────────────────

  private loadSprites() {
    for (const name of SPRITE_NAMES) {
      const img = new Image();
      img.src = `/serpiente/${name}.svg`;
      img.onload = () => {
        this.sprites[name] = img;
        // Invalidate any cached tints that used this sprite
        for (const key of [...this.spriteCache.keys()]) {
          if (key.includes(`:${name}:`)) this.spriteCache.delete(key);
        }
      };
    }
  }

  // ── Angular lifecycle ─────────────────────────────────────────

  ngOnChanges() {
    // If player colors changed, cached tints for those colors are stale
    const colorsStr = JSON.stringify(this.playerColors);
    if (colorsStr !== this.lastColorsStr) {
      this.lastColorsStr = colorsStr;
      this.spriteCache.clear();
    }
    this.lastState = this.gameState;
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  // ── Keyboard ──────────────────────────────────────────────────

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.myUid) return;
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
    this.zone.run(() => this.directionChanged.emit(dir));
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
    const S   = CELL;
    const now = Date.now();

    // ── Background (single bitmap blit) ──────────────────────
    ctx.drawImage(this.bgCanvas, 0, 0);

    // ── Food ─────────────────────────────────────────────────
    for (const food of (state.food ?? [])) {
      const cx = food.c * S + S / 2;
      const cy = food.r * S + S / 2;
      if (food.type === 'rainbow') {
        const hue = (now / 15) % 360;
        ctx.fillStyle   = `hsl(${hue}, 100%, 62%)`;
        ctx.shadowBlur  = 16;
        ctx.shadowColor = `hsl(${hue}, 100%, 62%)`;
      } else {
        ctx.fillStyle   = '#ffffff';
        ctx.shadowBlur  = 10;
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
      }
      this.drawStar(ctx, cx, cy, 8, S * 0.38, S * 0.16);
      ctx.shadowBlur = 0;
    }

    // ── Snakes ────────────────────────────────────────────────
    for (const uid of (state.players ?? [])) {
      const snake = state.snakes?.[uid];
      if (!snake) continue;

      const color = (this.playerColors[uid] ?? '#888888') as string;
      const alpha = snake.alive ? 1 : 0.3;
      const isMe  = uid === this.myUid;
      const body: number[][] = snake.body ?? [];
      if (body.length === 0) continue;

      // Draw tail → head so head always renders on top
      for (let i = body.length - 1; i >= 0; i--) {
        const [r, c] = body[i];
        const x = c * S;
        const y = r * S;

        if (i === 0) {
          const headSprite: SpriteName = isMe ? 'HEAD' : 'HEAD_2';
          this.drawSprite(ctx, headSprite, x, y, color, this.headAngle(snake.direction ?? 'up'), alpha);
        } else if (i === body.length - 1) {
          this.drawSprite(ctx, 'TAIL', x, y, color, this.tailAngle(body, i), alpha);
        } else {
          const { sprite, angle } = this.bodySprite(body, i);
          this.drawSprite(ctx, sprite, x, y, color, angle, alpha);
        }
      }
    }
  }

  // ── Sprite / angle helpers ────────────────────────────────────

  private headAngle(direction: string): number {
    switch (direction) {
      case 'up':    return 0;
      case 'right': return 90;
      case 'down':  return 180;
      case 'left':  return 270;
      default:      return 0;
    }
  }

  private tailAngle(body: number[][], tailIdx: number): number {
    // TAIL: body connection at TOP, tip at BOTTOM.
    // Rotate so connection faces toward body[tailIdx - 1].
    const tail = body[tailIdx];
    const prev = body[tailIdx - 1];
    const dr = prev[0] - tail[0];
    const dc = prev[1] - tail[1];
    if (dr < 0) return 0;    // prev above  → connection TOP    (canonical)
    if (dr > 0) return 180;  // prev below  → connection BOTTOM
    if (dc < 0) return 270;  // prev left   → connection LEFT
    return 90;               // prev right  → connection RIGHT
  }

  private bodySprite(body: number[][], i: number): { sprite: SpriteName; angle: number } {
    const cur  = body[i];
    const prev = body[i - 1];
    const next = body[i + 1];
    const d1   = this.cellDir(cur, prev);
    const d2   = this.cellDir(cur, next);

    // Straight
    if ((d1 === 'up'   && d2 === 'down')  || (d1 === 'down'  && d2 === 'up'))   return { sprite: 'BODY', angle: 0 };
    if ((d1 === 'left' && d2 === 'right') || (d1 === 'right' && d2 === 'left')) return { sprite: 'BODY', angle: 90 };

    // Corners — sprites already named by the two sides they connect
    const dirs = new Set([d1, d2]);
    if (dirs.has('up')   && dirs.has('right')) return { sprite: 'BODY_UP_RIGHT',   angle: 0 };
    if (dirs.has('down') && dirs.has('right')) return { sprite: 'BODY_DOWN_RIGHT', angle: 0 };
    if (dirs.has('down') && dirs.has('left'))  return { sprite: 'BODY_DOWN_LEFT',  angle: 0 };
    if (dirs.has('up')   && dirs.has('left'))  return { sprite: 'BODY_UP_LEFT',    angle: 0 };

    return { sprite: 'BODY', angle: 0 };
  }

  private cellDir(from: number[], to: number[]): string {
    const dr = to[0] - from[0];
    const dc = to[1] - from[1];
    if (dr < 0) return 'up';
    if (dr > 0) return 'down';
    if (dc < 0) return 'left';
    return 'right';
  }

  // ── Cached sprite drawing ─────────────────────────────────────
  // The first call for a (color, sprite, angle) combo renders a tiny CELL×CELL
  // bitmap and stores it. Every subsequent call is a single drawImage() blit —
  // ~10× faster than re-rendering the SVG + composite each frame.

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    name: SpriteName,
    x: number, y: number,
    color: string,
    angleDeg: number,
    alpha: number,
  ) {
    const cached = this.getCached(name, angleDeg, color);
    if (!cached) {
      // Sprite not loaded yet — plain square fallback
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.restore();
      return;
    }

    if (alpha < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(cached, x, y);
      ctx.restore();
    } else {
      ctx.drawImage(cached, x, y);
    }
  }

  private getCached(name: SpriteName, angleDeg: number, color: string): HTMLCanvasElement | null {
    const img = this.sprites[name];
    if (!img) return null;

    const key = `${color}:${name}:${angleDeg}`;
    const hit = this.spriteCache.get(key);
    if (hit) return hit;

    // Build the cached bitmap once
    const S  = CELL;
    const c  = document.createElement('canvas');
    c.width  = S;
    c.height = S;
    const tctx = c.getContext('2d')!;

    // Draw rotated SVG
    tctx.save();
    tctx.translate(S / 2, S / 2);
    tctx.rotate((angleDeg * Math.PI) / 180);
    tctx.drawImage(img, -S / 2, -S / 2, S, S);
    tctx.restore();

    // Tint: keep the sprite shape, fill with player color
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, S, S);
    tctx.globalCompositeOperation = 'source-over';

    this.spriteCache.set(key, c);
    return c;
  }

  // ── Food star ────────────────────────────────────────────────

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number,
                   spikes: number, outer: number, inner: number) {
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
