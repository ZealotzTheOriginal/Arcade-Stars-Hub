import {
  Component, Input, Output, EventEmitter,
  OnChanges, AfterViewInit, OnDestroy,
  ViewChild, ElementRef, HostListener, NgZone,
} from '@angular/core';

const CELL = 20;
const BOARD = 24;

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

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    canvas.focus();
    this.zone.runOutsideAngular(() => this.loop());
  }

  ngOnChanges() {
    this.lastState = this.gameState;
  }

  ngOnDestroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }

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

  private loop() {
    this.draw();
    this.animId = requestAnimationFrame(() => this.loop());
  }

  private draw() {
    const state = this.lastState;
    if (!state || !this.ctx) return;

    const ctx = this.ctx;
    const S = CELL;
    const N = BOARD;
    const now = Date.now();

    // Background
    ctx.fillStyle = '#0d0f18';
    ctx.fillRect(0, 0, N * S, N * S);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * S, 0); ctx.lineTo(i * S, N * S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * S); ctx.lineTo(N * S, i * S); ctx.stroke();
    }

    // Food
    for (const food of (state.food ?? [])) {
      const cx = food.c * S + S / 2;
      const cy = food.r * S + S / 2;
      if (food.type === 'rainbow') {
        const hue = (now / 15) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 62%)`;
        ctx.shadowBlur = 16;
        ctx.shadowColor = `hsl(${hue}, 100%, 62%)`;
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
      }
      this.drawStar(ctx, cx, cy, 8, S * 0.38, S * 0.16);
      ctx.shadowBlur = 0;
    }

    // Snakes
    for (const uid of (state.players ?? [])) {
      const snake = state.snakes?.[uid];
      if (!snake) continue;
      const color = (this.playerColors[uid] ?? '#888888') as string;
      ctx.globalAlpha = snake.alive ? 1 : 0.3;

      const body: number[][] = snake.body ?? [];

      // Draw body from tail to head (head renders on top)
      for (let i = body.length - 1; i >= 0; i--) {
        const [r, c] = body[i];
        const isHead = i === 0;
        const x = c * S;
        const y = r * S;
        const pad = isHead ? 1 : 2;
        const radius = isHead ? 5 : 3;

        if (isHead) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = color;
          ctx.fillStyle = this.brighten(color, 1.3);
        } else {
          ctx.shadowBlur = 0;
          // Fade toward tail
          const fade = 1 - (i / body.length) * 0.35;
          ctx.fillStyle = this.withAlpha(color, fade);
        }

        this.roundRect(ctx, x + pad, y + pad, S - pad * 2, S - pad * 2, radius);
        ctx.fill();
      }

      // Eyes on head
      if (body.length > 0 && snake.alive) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        const [r, c] = body[0];
        const hx = c * S, hy = r * S;
        const [ex1, ey1, ex2, ey2] = this.eyePos(snake.direction ?? 'right', hx, hy, S);
        ctx.beginPath(); ctx.arc(ex1, ey1, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex2, ey2, 2, 0, Math.PI * 2); ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }

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

  private roundRect(ctx: CanvasRenderingContext2D,
                    x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  private eyePos(dir: string, x: number, y: number, S: number): [number, number, number, number] {
    const m = S * 0.3;
    const sp = S * 0.28;
    switch (dir) {
      case 'right': return [x + S - m, y + S / 2 - sp, x + S - m, y + S / 2 + sp];
      case 'left':  return [x + m,     y + S / 2 - sp, x + m,     y + S / 2 + sp];
      case 'up':    return [x + S / 2 - sp, y + m,     x + S / 2 + sp, y + m    ];
      case 'down':  return [x + S / 2 - sp, y + S - m, x + S / 2 + sp, y + S - m];
      default:      return [x + S - m, y + S / 2 - sp, x + S - m, y + S / 2 + sp];
    }
  }

  private brighten(hex: string, f: number): string {
    if (!hex.startsWith('#') || hex.length < 7) return hex;
    const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * f));
    const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * f));
    const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * f));
    return `rgb(${r},${g},${b})`;
  }

  private withAlpha(hex: string, alpha: number): string {
    if (!hex.startsWith('#') || hex.length < 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
