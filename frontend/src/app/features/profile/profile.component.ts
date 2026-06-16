import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { WsService } from '../../core/services/ws.service';
import { UserProfile } from '../../core/models/user.model';
import { GameDefinition, LeaderboardEntry } from '../../core/models/game.model';

type Tab = 'stats' | 'games' | 'friends';

const AVATARS = [
  // Facciones y Escuadras Animales
  '🐉', '🦎', '🐀', '🦅', '🐺', '🦁', '🦂', '🦈', 
  
  // Amenaza Alienígena (Insectores) y Biología Sci-Fi
  '🛸', '👾', '🐜', '🕷️', '🧬', 
  
  // Tecnología, Flota y Estaciones Espaciales
  '🛰️', '🚀', '🚀', '🌌', '☄️', '🪐', 
  
  // Armamento, Táctica y Combate en Gravedad Cero
  '🛡️', '⚔️', '🎯', '💥', '⚡', '🔮', '🌀', '🔋',
  
  // Rangos, Victorias y Comandantes
  '👑', '🏆', '⭐', '🎖️'
];

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
  private ws = inject(WsService);

  profile = signal<UserProfile | null>(null);
  friends = signal<any[]>([]);
  games = signal<GameDefinition[]>([]);
  leaderboard = signal<LeaderboardEntry[]>([]);
  activeTab = signal<Tab>('stats');
  saving = signal(false);
  loadingFriends = signal(false);
  invitingFriend = signal<string | null>(null);
  editName = '';

  readonly avatars = AVATARS;

  readonly gameNames: Record<string, string> = {
    connect_four: 'Conecta Cuatro',
    tic_tac_toe: 'Tres en Raya',
    minesweeper: 'Buscaminas',
  };

  async ngOnInit() {
    const [profile, lb, gamesData] = await Promise.all([
      this.api.getMe(),
      this.api.getGlobalLeaderboard(),
      this.api.listGames(),
    ]);
    this.profile.set(profile);
    this.leaderboard.set(lb);
    this.games.set(gamesData);
    this.editName = profile.display_name;
  }

  setTab(tab: Tab) {
    this.activeTab.set(tab);
    if (tab === 'friends' && this.friends().length === 0) {
      this._loadFriends();
    }
  }

  private async _loadFriends() {
    this.loadingFriends.set(true);
    try {
      this.friends.set(await this.api.getFriends());
    } catch { /* silent */ } finally {
      this.loadingFriends.set(false);
    }
  }

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

  async removeFriend(uid: string) {
    try {
      await this.api.removeFriend(uid);
      this.friends.update(list => list.filter(f => f.uid !== uid));
    } catch { /* ignore */ }
  }

  startFriendInvite(uid: string) {
    this.invitingFriend.set(uid);
  }

  cancelFriendInvite() {
    this.invitingFriend.set(null);
  }

  inviteFriendToGame(game: GameDefinition) {
    const uid = this.invitingFriend();
    if (!uid) return;
    this.invitingFriend.set(null);
    this.ws.send('send_invite', { to_uid: uid, game_id: game.id });
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
