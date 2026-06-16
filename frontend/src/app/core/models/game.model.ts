export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail: string;
  max_players: number;
  has_ai: boolean;
  min_players: number;
}

export interface PlayerInfo {
  uid: string;
  display_name: string;
  avatar: string;
  is_ai?: boolean;
}

export interface GameRoom {
  room_id: string;
  game_id: string;
  host_uid: string;
  players: PlayerInfo[];
  status: 'waiting' | 'playing' | 'finished';
  game_state: any;
}

export interface LeaderboardEntry {
  uid: string;
  display_name: string;
  avatar: string;
  points: number;
  level: number;
  rank: number;
}
