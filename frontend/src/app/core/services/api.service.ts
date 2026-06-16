import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { GameDefinition, LeaderboardEntry } from '../models/game.model';
import { UserProfile, UserUpdate } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private async headers(): Promise<HttpHeaders> {
    const token = await this.auth.getToken();
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  // ── Users ──────────────────────────────────────────────
  async getMe(): Promise<UserProfile> {
    return firstValueFrom(
      this.http.get<UserProfile>(`${environment.apiUrl}/users/me`, {
        headers: await this.headers(),
      })
    );
  }

  async updateMe(update: Partial<UserProfile>): Promise<UserProfile> {
    return firstValueFrom(
      this.http.patch<UserProfile>(`${environment.apiUrl}/users/me`, update, {
        headers: await this.headers(),
      })
    );
  }

  async addFriend(friendUid: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/users/friends/${friendUid}`, {}, {
        headers: await this.headers(),
      })
    );
  }

  // ── Games ──────────────────────────────────────────────
  async listGames(): Promise<GameDefinition[]> {
    return firstValueFrom(this.http.get<GameDefinition[]>(`${environment.apiUrl}/games/`));
  }

  async createRoom(gameId: string, displayName: string, avatar: string): Promise<{ room_id: string }> {
    return firstValueFrom(
      this.http.post<{ room_id: string }>(`${environment.apiUrl}/games/rooms`, {
        game_id: gameId, display_name: displayName, avatar,
      }, { headers: await this.headers() })
    );
  }

  async getRoom(roomId: string): Promise<any> {
    return firstValueFrom(
      this.http.get(`${environment.apiUrl}/games/rooms/${roomId}`, {
        headers: await this.headers(),
      })
    );
  }

  // ── Leaderboard ────────────────────────────────────────
  async getGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
    return firstValueFrom(this.http.get<LeaderboardEntry[]>(`${environment.apiUrl}/leaderboard/`));
  }

  async getGameLeaderboard(gameId: string): Promise<LeaderboardEntry[]> {
    return firstValueFrom(this.http.get<LeaderboardEntry[]>(`${environment.apiUrl}/leaderboard/${gameId}`));
  }
}
