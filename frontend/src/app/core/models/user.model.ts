export interface GameStats {
  played: number;
  won: number;
  points: number;
}

export interface UserSettings {
  language: 'es' | 'en';
  notify_friend_requests: boolean;
  notify_game_invites: boolean;
  hide_online_status: boolean;
  block_friend_requests: boolean;
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
  ttt_pattern?: string;
  is_admin?: boolean;
  badges?: string[];
  settings: UserSettings;
}

export interface UserUpdate {
  display_name?: string;
  avatar?: string;
  ttt_pattern?: string;
}

export interface UserSettingsUpdate {
  language?: 'es' | 'en';
  notify_friend_requests?: boolean;
  notify_game_invites?: boolean;
  hide_online_status?: boolean;
  block_friend_requests?: boolean;
}
