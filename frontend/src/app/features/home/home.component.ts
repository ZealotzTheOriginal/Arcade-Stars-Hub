import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';
import { UserProfile } from '../../core/models/user.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  games = signal<GameDefinition[]>([]);
  leaderboard = signal<LeaderboardEntry[]>([]);
  profile = signal<UserProfile | null>(null);
  loading = signal(true);
  creatingRoom = signal<string | null>(null);
  error = signal('');

  joinCode = '';
  joiningRoom = signal(false);
  joinError = signal('');

  async ngOnInit() {
    // Only games list is critical — it's pure in-memory, no Firestore needed
    try {
      const games = await this.api.listGames();
      this.games.set(games);
    } catch (e: any) {
      const status = e?.status ?? 'sin respuesta';
      const msg    = e?.message ?? String(e);
      this.error.set(`Error ${status}: ${msg}`);
      console.error('listGames failed:', e);
    } finally {
      this.loading.set(false);
    }

    // These require Firestore/Firebase — load in background, don't block games
    this.api.getGlobalLeaderboard()
      .then((lb) => this.leaderboard.set(lb))
      .catch((e) => console.warn('Leaderboard unavailable:', e));

    this.api.getMe()
      .then((p) => this.profile.set(p))
      .catch((e) => console.warn('Profile unavailable:', e));
  }

  async joinRoom() {
    const code = this.joinCode.trim().toUpperCase();
    if (!code) return;
    this.joinError.set('');
    this.joiningRoom.set(true);
    try {
      const room = await this.api.getRoom(code);
      this.router.navigate(['/room', code], { queryParams: { game: room.game_id } });
    } catch (e: any) {
      this.joinError.set(e?.status === 404 ? 'Sala no encontrada.' : 'Error al unirse a la sala.');
    } finally {
      this.joiningRoom.set(false);
    }
  }

  async playGame(game: GameDefinition) {
    this.creatingRoom.set(game.id);
    try {
      const p = this.profile();
      const { room_id } = await this.api.createRoom(
        game.id,
        p?.display_name ?? 'Player',
        p?.avatar ?? '⭐'
      );
      this.router.navigate(['/room', room_id], { queryParams: { game: game.id } });
    } finally {
      this.creatingRoom.set(null);
    }
  }

  logout() {
    this.auth.logout();
  }
}
