import { Injectable, signal, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { WSMessage } from '../models/ws-events.model';

@Injectable({ providedIn: 'root' })
export class WsService {
  private auth = inject(AuthService);
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private pongTimeout?: ReturnType<typeof setTimeout>;

  private readonly MAX_RECONNECT = 8;
  private readonly HEARTBEAT_MS = 20_000;
  private readonly PONG_TIMEOUT_MS = 5_000;

  readonly connected = signal(false);
  readonly fatalError = signal(false);
  readonly messages$ = new Subject<WSMessage>();
  readonly reconnected$ = new Subject<void>();

  constructor() {
    // Reconnect when tab becomes visible again after being backgrounded
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.shouldReconnect && !this.connected()) {
        this._scheduleReconnect(0);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.token = await this.auth.getToken();
    if (!this.token) throw new Error('Not authenticated');
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.fatalError.set(false);
    return this._open();
  }

  private _open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${environment.wsUrl}?token=${this.token}`);

      this.ws.onopen = () => {
        this.connected.set(true);
        this.fatalError.set(false);
        if (this.reconnectAttempts > 0) {
          this.reconnected$.next();
        }
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WSMessage;
          if (msg.event === 'pong') {
            clearTimeout(this.pongTimeout);
            return;
          }
          this.messages$.next(msg);
        } catch { /* ignore malformed */ }
      };

      this.ws.onclose = () => {
        this.connected.set(false);
        this._stopHeartbeat();
        if (this.shouldReconnect) {
          if (this.reconnectAttempts < this.MAX_RECONNECT) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 8000);
            this._scheduleReconnect(delay);
          } else {
            this.fatalError.set(true);
          }
        }
      };

      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
  }

  private _scheduleReconnect(delay: number) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      this.token = await this.auth.getToken();
      this._open().catch(() => {});
    }, delay);
  }

  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event: 'ping', data: {} }));
        this.pongTimeout = setTimeout(() => {
          this.ws?.close();
        }, this.PONG_TIMEOUT_MS);
      }
    }, this.HEARTBEAT_MS);
  }

  private _stopHeartbeat() {
    clearInterval(this.heartbeatInterval);
    clearTimeout(this.pongTimeout);
  }

  send(event: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  /** Try to reconnect manually after a fatal error. */
  manualReconnect() {
    this.reconnectAttempts = 0;
    this.fatalError.set(false);
    this._scheduleReconnect(0);
  }

  disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    this._stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.connected.set(false);
  }
}
