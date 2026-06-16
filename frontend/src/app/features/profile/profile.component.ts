import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { UserProfile } from '../../core/models/user.model';
import { LeaderboardEntry } from '../../core/models/game.model';

type Tab = 'stats' | 'games' | 'friends';

const AVATARS = ['⭐', '🔥', '💎', '🦊', '🐉', '👾', '🎮', '🏆', '🚀', '🌟'];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  profile = signal<UserProfile | null>(null);
  leaderboard = signal<LeaderboardEntry[]>([]);
  activeTab = signal<Tab>('stats');
  saving = signal(false);
  editName = '';

  readonly avatars = AVATARS;

  readonly gameNames: Record<string, string> = {
    connect_four: 'Conecta Cuatro',
    tic_tac_toe: 'Tres en Raya',
    minesweeper: 'Buscaminas',
  };

  async ngOnInit() {
    const [profile, lb] = await Promise.all([
      this.api.getMe(),
      this.api.getGlobalLeaderboard(),
    ]);
    this.profile.set(profile);
    this.leaderboard.set(lb);
    this.editName = profile.display_name;
  }

  setTab(tab: Tab) { this.activeTab.set(tab); }

  async selectAvatar(avatar: string) {
    await this.api.updateMe({ avatar } as any);
    this.profile.update((p) => p ? { ...p, avatar } : p);
  }

  async saveName() {
    if (!this.editName.trim()) return;
    this.saving.set(true);
    try {
      const updated = await this.api.updateMe({ display_name: this.editName } as any);
      this.profile.set(updated);
    } finally {
      this.saving.set(false);
    }
  }

  gameStatsList(): Array<{ id: string; name: string; played: number; won: number; points: number }> {
    const stats = this.profile()?.game_stats ?? {};
    return Object.entries(stats).map(([id, s]) => ({
      id,
      name: this.gameNames[id] ?? id,
      played: s.played,
      won: s.won,
      points: s.points,
    }));
  }

  logout() { this.auth.logout(); }
}
