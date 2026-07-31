import { Component, OnInit, OnDestroy, inject, signal, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { AuthService } from './core/services/auth.service';
import { WsService } from './core/services/ws.service';
import { ChallengeAnimService } from './core/services/challenge-anim.service';
import { NotificationService } from './core/services/notification.service';
import { FriendsService } from './core/services/friends.service';
import { UserProfileService } from './core/services/user-profile.service';
import { LobbyService } from './core/services/lobby.service';
import { LanguageService } from './core/services/language.service';
import { ToastService } from './core/services/toast.service';
import { InviteData, InviteAcceptedData } from './core/models/ws-events.model';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, ToastContainerComponent, TranslatePipe],
  template: `
    <router-outlet />

    <app-toast-container />

    @if (activeInvite()) {
      <div class="invite-toast">
        <div class="invite-content">
          <span class="invite-avatar">{{ activeInvite()!.from_avatar }}</span>
          <div class="invite-body">
            <p class="invite-text">
              <strong>{{ activeInvite()!.from_name }}</strong> {{ 'APP.INVITES_YOU' | translate }}
            </p>
            <div class="invite-bar">
              <div class="invite-bar-fill" [style.width.%]="timerPercent()"></div>
            </div>
          </div>
          <div class="invite-btns">
            <button class="btn btn--primary btn-sm" (click)="acceptInvite()">{{ 'PROFILE.ACCEPT' | translate }}</button>
            <button class="btn btn--ghost btn-sm" (click)="rejectInvite()">{{ 'HOME.REJECT' | translate }}</button>
          </div>
        </div>
      </div>
    }

    @if (rejectedBy()) {
      <div class="rejected-toast">
        <i class="fa-solid fa-circle-xmark rejected-icon"></i>
        <span><strong>{{ rejectedBy() }}</strong> {{ 'APP.REJECTED_YOUR_INVITE' | translate }}</span>
      </div>
    }

    @if (inviteError()) {
      <div class="invite-error-toast">
        <i class="fa-solid fa-door-closed invite-error-icon"></i>
        <span>{{ inviteError() }}</span>
      </div>
    }

    @if (friendRequest()) {
      <div class="friend-request-toast">
        <span class="fr-avatar">{{ friendRequest()!.avatar }}</span>
        <div class="fr-body">
          <p class="fr-text"><strong>{{ friendRequest()!.name }}</strong> {{ 'PROFILE.SENT_FRIEND_REQUEST' | translate }}</p>
          <div class="fr-bar">
            <div class="fr-bar-fill" [style.width.%]="frTimerPercent()"></div>
          </div>
        </div>
        <div class="fr-btns">
          <button class="btn btn--primary btn-sm" (click)="acceptFriendRequestToast()">{{ 'PROFILE.ACCEPT' | translate }}</button>
          <button class="fr-close" (click)="dismissFriendRequestToast()" [title]="'APP.ACCEPT_LATER_HINT' | translate">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    }

    @if (challengeAnim.active()) {
      <div class="reto-overlay">
        <div class="reto-blur"></div>
        <div class="reto-flash"></div>
        <div class="reto-bar-top"></div>
        <div class="reto-bar-bottom"></div>
        <div class="reto-text">{{ 'APP.CHALLENGE_ACCEPTED' | translate }}</div>
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
    .invite-content { display: flex; align-items: center; gap: 0.875rem; }
    .invite-avatar { font-size: 2.25rem; flex-shrink: 0; }
    .invite-body { flex: 1; min-width: 0; }
    .invite-text { margin: 0 0 0.5rem; color: #e0e0e0; font-size: 0.875rem; line-height: 1.3; }
    .invite-bar { height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
    .invite-bar-fill { height: 100%; background: #6e46dc; transition: width 0.1s linear; }
    .invite-btns { display: flex; flex-direction: column; gap: 0.375rem; flex-shrink: 0; }
    .btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }

    /* ── Rejection toast ─────────────────────────────────── */
    .rejected-toast {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
      background: #13131f;
      border: 1px solid rgba(220, 70, 70, 0.6);
      border-radius: 14px;
      padding: 0.85rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 260px;
      max-width: 360px;
      color: #e0e0e0;
      font-size: 0.875rem;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.3s cubic-bezier(.22,1,.36,1);
    }
    .rejected-icon { color: #dc4646; font-size: 1.2rem; flex-shrink: 0; }

    /* ── Invite failed toast ─────────────────────────────── */
    .invite-error-toast {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
      background: #13131f;
      border: 1px solid rgba(251, 146, 60, 0.6);
      border-radius: 14px;
      padding: 0.85rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 260px;
      max-width: 380px;
      color: #e0e0e0;
      font-size: 0.875rem;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.3s cubic-bezier(.22,1,.36,1);
    }
    .invite-error-icon { color: #fb923c; font-size: 1.2rem; flex-shrink: 0; }

    /* ── Friend request toast ───────────────────────────────── */
    .friend-request-toast {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
      background: #13131f;
      border: 1px solid rgba(0, 200, 170, 0.55);
      border-radius: 14px;
      padding: 0.9rem 1rem 0.9rem 1.1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 280px;
      max-width: 370px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,200,170,0.12);
      animation: slideIn 0.3s cubic-bezier(.22,1,.36,1);
    }
    .fr-avatar { font-size: 2rem; flex-shrink: 0; }
    .fr-body { flex: 1; min-width: 0; }
    .fr-text { margin: 0 0 0.5rem; color: #e0e0e0; font-size: 0.85rem; line-height: 1.35; }
    .fr-bar { height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
    .fr-bar-fill { height: 100%; background: #00c8aa; transition: width 0.1s linear; }
    .fr-btns { display: flex; flex-direction: column; align-items: center; gap: 0.375rem; flex-shrink: 0; }
    .fr-close {
      background: none; border: none; color: rgba(255,255,255,0.35);
      cursor: pointer; padding: 0.2rem; font-size: 0.95rem; flex-shrink: 0;
    }
    .fr-close:hover { color: rgba(255,255,255,0.7); }

    /* ── "RETO ACEPTADO" overlay ──────────────────────────── */
    .reto-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      overflow: hidden;
      pointer-events: none;
    }

    /* Dark blurred backdrop — fades in with the bars, fades out with them too */
    .reto-blur {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 18, 0.82);
      backdrop-filter: blur(6px);
      opacity: 0;
      animation: reto-fade-in 0.3s ease forwards, reto-elem-out 0.6s ease 1.8s forwards;
    }

    /* Brief white flash (Pokémon-style) */
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

    /* Top cinematic bar — left edge deeper, right edge shallower */
    .reto-bar-top {
      position: absolute;
      top: 0; left: -3%; right: -3%;
      height: 40vh;
      background: #06060f;
      clip-path: polygon(0 0, 100% 0, 100% 70%, 0 100%);
      transform: translateY(-110%);
      z-index: 2;
      animation:
        reto-bar-top-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards,
        reto-elem-out   0.5s ease 1.8s forwards;
    }

    /* Bottom cinematic bar — mirror asymmetry */
    .reto-bar-bottom {
      position: absolute;
      bottom: 0; left: -3%; right: -3%;
      height: 40vh;
      background: #06060f;
      clip-path: polygon(0 30%, 100% 0, 100% 100%, 0 100%);
      transform: translateY(110%);
      z-index: 2;
      animation:
        reto-bar-bottom-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards,
        reto-elem-out      0.5s ease 1.8s forwards;
    }

    @keyframes reto-bar-top-in    { to { transform: translateY(0); } }
    @keyframes reto-bar-bottom-in { to { transform: translateY(0); } }
    @keyframes reto-fade-in  { to { opacity: 1; } }
    @keyframes reto-elem-out { to { opacity: 0; } }

    /* "RETO ACEPTADO" rainbow gradient text */
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
        #ff0000 0%, #ffc700 25%, #45f6d7 50%, #4643ff 75%, #ff00d6 100%
      );
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      opacity: 0;
      animation:
        reto-text-in  0.4s ease 0.7s forwards,
        reto-elem-out 0.5s ease 1.8s forwards;
    }
    @keyframes reto-text-in {
      from { opacity: 0; transform: scale(0.8) translateY(10px); letter-spacing: 0.55em; }
      to   { opacity: 1; transform: scale(1) translateY(0);      letter-spacing: 0.25em; }
    }

  `],
})
export class App implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private ws = inject(WsService);
  private router = inject(Router);
  readonly challengeAnim = inject(ChallengeAnimService);
  private notifService = inject(NotificationService);
  private friendsSvc = inject(FriendsService);
  private profileSvc = inject(UserProfileService);
  private lobbySvc = inject(LobbyService);
  private langSvc = inject(LanguageService);
  private toast = inject(ToastService);
  private translate = inject(TranslateService);

  activeInvite = signal<InviteData | null>(null);
  timerPercent = signal(100);
  rejectedBy = signal<string | null>(null);
  friendRequest = signal<{ uid: string; name: string; avatar: string } | null>(null);
  frTimerPercent = signal(100);
  inviteError = signal<string | null>(null);

  private inviteTimer?: ReturnType<typeof setInterval>;
  private rejectedTimer?: ReturnType<typeof setTimeout>;
  private frTimer?: ReturnType<typeof setTimeout>;
  private frProgressTimer?: ReturnType<typeof setInterval>;
  private inviteErrorTimer?: ReturnType<typeof setTimeout>;
  private lobbyPollInterval?: ReturnType<typeof setInterval>;
  private subs: Subscription[] = [];
  private readonly INVITE_SECONDS = 15;
  private readonly FR_SECONDS = 8;

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const loading = this.auth.loading();
      if (loading) return;
      if (user) {
        this.ws.connect().then(async () => {
          // Firestore's display_name/avatar is the live, editable copy — the
          // Firebase Auth user object's own `displayName` is frozen at signup
          // and would silently reintroduce a stale name here otherwise.
          const profile = await this.profileSvc.load().catch(() => null);
          this.langSvc.syncFromProfile(profile?.settings?.language);
          this.ws.send('register_presence', {
            display_name: profile?.display_name || 'Player',
            avatar: profile?.avatar || '⭐',
          });
          // Small delay gives the WS message time to be processed server-side
          // before we fetch, so we see ourselves in the online list right away.
          setTimeout(() => {
            this.lobbySvc.loadOnlineUsers().catch(() => {});
            this.lobbySvc.loadActiveRooms().catch(() => {});
          }, 350);
          this.lobbyPollInterval = setInterval(() => {
            this.lobbySvc.loadOnlineUsers().catch(() => {});
            this.lobbySvc.loadActiveRooms().catch(() => {});
          }, 15_000);
        }).catch(() => {});
      } else {
        this.profileSvc.clear();
        clearInterval(this.lobbyPollInterval);
        this.ws.disconnect();
      }
    });
  }

  ngOnInit() {
    this.subs.push(
      this.ws.messages$.subscribe((msg) => {
        if (msg.event === 'lobby_update') {
          this.lobbySvc.setActiveRooms(msg.data.rooms ?? []);
          this.lobbySvc.setOnlineUsers(msg.data.online_users ?? []);
        }
        if (msg.event === 'invite_received') {
          if (this.profileSvc.profile()?.settings?.notify_game_invites !== false) {
            this._showInvite(msg.data as InviteData);
          }
        }
        if (msg.event === 'invite_response' && msg.data?.accepted === false) {
          clearTimeout(this.rejectedTimer);
          this.rejectedBy.set(msg.data.from_name ?? this.translate.instant('APP.THE_USER'));
          this.rejectedTimer = setTimeout(() => this.rejectedBy.set(null), 4000);
        }
        if (msg.event === 'friend_request') {
          this.friendsSvc.load().catch(() => {});
          if (this.profileSvc.profile()?.settings?.notify_friend_requests !== false) {
            this._showFriendRequest(msg.data.from_uid, msg.data.from_name, msg.data.from_avatar);
            this.notifService.addFriendRequest();
          }
        }
        if (msg.event === 'friend_request_accepted') {
          // The other side just accepted (or completed mutuality by adding us
          // back) — always refresh so our semi-friend heart flips to solid
          // right away; only the celebratory toast is gated by the setting.
          this.friendsSvc.load().catch(() => {});
          if (this.profileSvc.profile()?.settings?.notify_friend_requests !== false) {
            this.toast.success(this.translate.instant('APP.ACCEPTED_YOUR_REQUEST', { name: msg.data.from_name }));
          }
        }
        if (msg.event === 'friend_request_rejected') {
          this.notifService.addFriendRequestRejected(msg.data.from_name, msg.data.from_avatar);
          this.friendsSvc.load().catch(() => {});
        }
        if (msg.event === 'friend_removed') {
          this.notifService.addFriendRemoved(msg.data.from_name, msg.data.from_avatar);
          this.friendsSvc.load().catch(() => {});
        }
        if (msg.event === 'invite_failed') {
          clearTimeout(this.inviteErrorTimer);
          this.inviteError.set(msg.data?.message ?? this.translate.instant('APP.ROOM_NO_LONGER_AVAILABLE'));
          this.inviteErrorTimer = setTimeout(() => this.inviteError.set(null), 5000);
        }
        if (msg.event === 'invite_accepted') {
          this._clearInvite();
          const data = msg.data as InviteAcceptedData;
          this.challengeAnim.show();
          // If already in the target room (inviter redirected back to their own room),
          // skip navigation — leaving would destroy the room via leave_room.
          if (this.router.url.startsWith(`/room/${data.room_id}`)) {
            return;
          }
          // Navigate through /home first to force Angular to destroy any active
          // GameRoomComponent (same-pattern routes are reused without destroy).
          this.router.navigate(['/home']).then(() => {
            this.router.navigate(['/room', data.room_id], {
              queryParams: { game: data.game_id, invited: '1' },
            });
          });
        }
      }),
      this.ws.reconnected$.subscribe(() => {
        const profile = this.profileSvc.profile();
        if (profile) {
          this.ws.send('register_presence', {
            display_name: profile.display_name,
            avatar: profile.avatar,
          });
        }
      }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
    clearInterval(this.inviteTimer);
    clearTimeout(this.rejectedTimer);
    clearTimeout(this.frTimer);
    clearInterval(this.frProgressTimer);
    clearTimeout(this.inviteErrorTimer);
    clearInterval(this.lobbyPollInterval);
  }

  private _showFriendRequest(uid: string, name: string, avatar: string) {
    clearTimeout(this.frTimer);
    clearInterval(this.frProgressTimer);
    this.friendRequest.set({ uid, name, avatar });
    this.frTimerPercent.set(100);
    let elapsed = 0;
    const total = this.FR_SECONDS * 1000;
    this.frProgressTimer = setInterval(() => {
      elapsed += 100;
      this.frTimerPercent.set(Math.max(0, 100 - (elapsed / total) * 100));
    }, 100);
    // After this, the request isn't lost — it stays visible in Notifications
    // (Profile → Amigos) until accepted or rejected from there.
    this.frTimer = setTimeout(() => this._clearFriendRequestToast(), total);
  }

  async acceptFriendRequestToast() {
    const fr = this.friendRequest();
    if (!fr) return;
    this._clearFriendRequestToast();
    try {
      await this.friendsSvc.accept(fr.uid);
      this.notifService.decrementUnread();
      this.toast.success(this.translate.instant('APP.NOW_FRIENDS_WITH', { name: fr.name }));
    } catch { /* toast shown by the error interceptor */ }
  }

  dismissFriendRequestToast() {
    this._clearFriendRequestToast();
  }

  private _clearFriendRequestToast() {
    clearTimeout(this.frTimer);
    clearInterval(this.frProgressTimer);
    this.friendRequest.set(null);
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
      if (elapsed >= total) this.rejectInvite(true);
    }, 100);
  }

  acceptInvite() {
    const inv = this.activeInvite();
    if (!inv) return;
    const payload: any = { to_uid: inv.from_uid, accepted: true, game_id: inv.game_id };
    if (inv.room_id) payload.room_id = inv.room_id;
    this.ws.send('respond_invite', payload);
    this._clearInvite();
  }

  rejectInvite(missed = false) {
    const inv = this.activeInvite();
    if (inv) {
      this.ws.send('respond_invite', { to_uid: inv.from_uid, accepted: false });
      if (missed) {
        this.notifService.addMissedInvite(inv.from_name, inv.from_avatar, inv.game_id);
      }
    }
    this._clearInvite();
  }

  private _clearInvite() {
    clearInterval(this.inviteTimer);
    this.activeInvite.set(null);
  }
}
