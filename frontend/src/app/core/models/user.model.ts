export interface GameStats {
  played: number;
  won: number;
  points: number;
}

export interface UserProfile {
  uid: string;
  display_name: string;
  email: string;
  avatar: string;
  level: number;
  total_points: number;
  game_stats: Record<string, GameStats>;
  friends: string[];
}

export interface UserUpdate {
  display_name?: string;
  avatar?: string;
}
