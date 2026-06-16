import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { WsService } from './core/services/ws.service';
import { InviteData } from './core/models/ws-events.model';

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
  `,
  styles: [`
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
  `],
})
export class App implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private router = inject(Router);

  activeInvite = signal<InviteData | null>(null);
  timerPercent = signal(100);

  private inviteTimer?: ReturnType<typeof setInterval>;
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
    this.ws.send('respond_invite', { to_uid: inv.from_uid, accepted: true, room_id: inv.room_id });
    this.router.navigate(['/room', inv.room_id], { queryParams: { game: inv.game_id } });
    this._clearInvite();
  }

  rejectInvite() {
    const inv = this.activeInvite();
    if (inv) {
      this.ws.send('respond_invite', { to_uid: inv.from_uid, accepted: false, room_id: inv.room_id });
    }
    this._clearInvite();
  }

  private _clearInvite() {
    clearInterval(this.inviteTimer);
    this.activeInvite.set(null);
  }
}
