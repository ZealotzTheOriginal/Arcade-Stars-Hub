import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { WsService } from './core/services/ws.service';
import { InviteData, InviteAcceptedData } from './core/models/ws-events.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <router-outlet />

    @if (activeInvite()) {
      <div class="invite-toast">
        <div class="invite-content">
          <span class="invite-avatar">{{ activeInvite()!.from_avatar }}</span>
          <div class="invite-body">
            <p class="invite-text">
              <strong>{{ activeInvite()!.from_name }}</strong> te invita a jugar
            </p>
            <div class="invite-bar">
              <div class="invite-bar-fill" [style.width.%]="timerPercent()"></div>
            </div>
          </div>
          <div class="invite-btns">
            <button class="btn btn--primary btn-sm" (click)="acceptInvite()">Aceptar</button>
            <button class="btn btn--ghost btn-sm" (click)="rejectInvite()">Rechazar</button>
          </div>
        </div>
      </div>
    }

    @if (showChallengeAnim()) {
      <div class="reto-overlay">
        <div class="reto-blur"></div>
        <div class="reto-flash"></div>
        <div class="reto-bar-top"></div>
        <div class="reto-bar-bottom"></div>
        <div class="reto-text">RETO ACEPTADO</div>
      </div>
    }
  `,
  styles: [`
    /* ── Invite toast ─────────────────────────────────────── */
    .invite-toast {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
      background: #13131f;
      border: 1px solid rgba(110, 70, 220, 0.6);
      border-radius: 14px;
      padding: 1rem 1.25rem;
      min-width: 300px;
      max-width: 380px;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.3s cubic-bezier(.22,1,.36,1);
    }
    @keyframes slideIn {
      from { transform: translateX(110%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    .invite-content {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }
    .invite-avatar { font-size: 2.25rem; flex-shrink: 0; }
    .invite-body { flex: 1; min-width: 0; }
    .invite-text {
      margin: 0 0 0.5rem;
      color: #e0e0e0;
      font-size: 0.875rem;
      line-height: 1.3;
    }
    .invite-bar {
      height: 3px;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    .invite-bar-fill {
      height: 100%;
      background: #6e46dc;
      transition: width 0.1s linear;
    }
    .invite-btns {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      flex-shrink: 0;
    }
    .btn-sm {
      padding: 0.3rem 0.75rem;
      font-size: 0.78rem;
    }

    /* ── "RETO ACEPTADO" animation ────────────────────────── */
    .reto-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      overflow: hidden;
      pointer-events: none;
    }

    /* Blurred dark backdrop */
    .reto-blur {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 18, 0.78);
      backdrop-filter: blur(6px);
      opacity: 0;
      animation: reto-fade-in 0.3s ease forwards, reto-fade-out 0.5s ease 2s forwards;
    }

    /* Brief white flash at the start (Pokémon-style) */
    .reto-flash {
      position: absolute;
      inset: 0;
      background: white;
      opacity: 0;
      z-index: 1;
      animation: reto-flash-anim 0.45s ease-out forwards;
    }
    @keyframes reto-flash-anim {
      0%   { opacity: 0.85; }
      100% { opacity: 0; }
    }

    /* Top cinematic bar — asymmetric diagonal cut */
    .reto-bar-top {
      position: absolute;
      top: 0; left: -3%; right: -3%;
      height: 40vh;
      background: #06060f;
      /* Left edge reaches 100% bar height, right edge only 70% → steep left, gentle right */
      clip-path: polygon(0 0, 100% 0, 100% 70%, 0 100%);
      transform: translateY(-110%);
      z-index: 2;
      animation:
        reto-bar-top-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards,
        reto-fade-out 0.5s ease 2s forwards;
    }

    /* Bottom cinematic bar — mirror of top, asymmetric */
    .reto-bar-bottom {
      position: absolute;
      bottom: 0; left: -3%; right: -3%;
      height: 40vh;
      background: #06060f;
      /* Left edge starts at 30% from top (gentle), right edge at 0% (steep) */
      clip-path: polygon(0 30%, 100% 0, 100% 100%, 0 100%);
      transform: translateY(110%);
      z-index: 2;
      animation:
        reto-bar-bottom-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards,
        reto-fade-out 0.5s ease 2s forwards;
    }

    @keyframes reto-bar-top-in    { to { transform: translateY(0); } }
    @keyframes reto-bar-bottom-in { to { transform: translateY(0); } }
    @keyframes reto-fade-in  { to { opacity: 1; } }
    @keyframes reto-fade-out { to { opacity: 0; } }

    /* "RETO ACEPTADO" text with rainbow gradient */
    .reto-text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3;
      font-size: clamp(1.6rem, 5vw, 3.5rem);
      font-weight: 900;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg,
        #ff0000 0%,
        #ffc700 25%,
        #45f6d7 50%,
        #4643ff 75%,
        #ff00d6 100%
      );
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      opacity: 0;
      animation:
        reto-text-in 0.4s ease 0.7s forwards,
        reto-fade-out 0.5s ease 2s forwards;
    }

    @keyframes reto-text-in {
      from {
        opacity: 0;
        transform: scale(0.8) translateY(10px);
        letter-spacing: 0.55em;
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
        letter-spacing: 0.25em;
      }
    }
  `],
})
export class App implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private router = inject(Router);

  activeInvite = signal<InviteData | null>(null);
  timerPercent = signal(100);
  showChallengeAnim = signal<InviteAcceptedData | null>(null);

  private inviteTimer?: ReturnType<typeof setInterval>;
  private challengeNavTimer?: ReturnType<typeof setTimeout>;
  private subs: Subscription[] = [];
  private readonly INVITE_SECONDS = 15;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const loading = this.auth.loading();
      if (loading) return;
      if (user) {
        this.ws.connect().then(() => {
          this.ws.send('register_presence', {
            display_name: user.displayName || 'Player',
            avatar: '⭐',
          });
        }).catch(() => {});
      } else {
        this.ws.disconnect();
      }
    });
  }

  ngOnInit() {
    this.subs.push(
      this.ws.messages$.subscribe((msg) => {
        if (msg.event === 'invite_received') {
          this._showInvite(msg.data as InviteData);
        }
        if (msg.event === 'invite_accepted') {
          this._clearInvite();
          const data = msg.data as InviteAcceptedData;
          this.showChallengeAnim.set(data);
          this.challengeNavTimer = setTimeout(() => {
            this.showChallengeAnim.set(null);
            // Navigate through /home first so Angular is forced to destroy the current
            // GameRoomComponent (Angular reuses the component instance when navigating
            // between routes of the same pattern, e.g. /room/A → /room/B).
            this.router.navigate(['/home']).then(() => {
              this.router.navigate(['/room', data.room_id], { queryParams: { game: data.game_id } });
            });
          }, 2500);
        }
      }),
      this.ws.reconnected$.subscribe(() => {
        const user = this.auth.currentUser();
        if (user) {
          this.ws.send('register_presence', {
            display_name: user.displayName || 'Player',
            avatar: '⭐',
          });
        }
      }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
    clearInterval(this.inviteTimer);
    clearTimeout(this.challengeNavTimer);
  }

  private _showInvite(data: InviteData) {
    clearInterval(this.inviteTimer);
    this.activeInvite.set(data);
    this.timerPercent.set(100);
    let elapsed = 0;
    const total = this.INVITE_SECONDS * 1000;
    this.inviteTimer = setInterval(() => {
      elapsed += 100;
      this.timerPercent.set(Math.max(0, 100 - (elapsed / total) * 100));
      if (elapsed >= total) this.rejectInvite();
    }, 100);
  }

  acceptInvite() {
    const inv = this.activeInvite();
    if (!inv) return;
    // Backend creates the room and notifies both players via 'invite_accepted'.
    // Navigation happens when that event is received.
    this.ws.send('respond_invite', { to_uid: inv.from_uid, accepted: true, game_id: inv.game_id });
    this._clearInvite();
  }

  rejectInvite() {
    const inv = this.activeInvite();
    if (inv) {
      this.ws.send('respond_invite', { to_uid: inv.from_uid, accepted: false });
    }
    this._clearInvite();
  }

  private _clearInvite() {
    clearInterval(this.inviteTimer);
    this.activeInvite.set(null);
  }
}
