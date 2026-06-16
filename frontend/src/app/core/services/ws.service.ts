import { Injectable, signal, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { WSMessage } from '../models/ws-events.model';

@Injectable({ providedIn: 'root' })
export class WsService {
  private auth = inject(AuthService);
  private ws: WebSocket | null = null;

  readonly connected = signal(false);
  readonly messages$ = new Subject<WSMessage>();

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const token = await this.auth.getToken();
    if (!token) throw new Error('Not authenticated');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${environment.wsUrl}?token=${token}`);

      this.ws.onopen = () => {
        this.connected.set(true);
        resolve();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg: WSMessage = JSON.parse(e.data);
          this.messages$.next(msg);
        } catch { /* ignore malformed */ }
      };

      this.ws.onclose = () => {
        this.connected.set(false);
      };

      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
  }

  send(event: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected.set(false);
  }
}
