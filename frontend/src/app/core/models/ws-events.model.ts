export type ServerEvent =
  | 'room_state'
  | 'player_joined'
  | 'player_left'
  | 'game_started'
  | 'move_made'
  | 'game_over'
  | 'chat_message'
  | 'ai_thinking'
  | 'error'
  | 'pong'
  | 'room_closed'
  | 'rematch_vote'
  | 'game_reset'
  | 'invite_received'
  | 'invite_response'
  | 'spectator_joined'
  | 'spectator_left'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'game_abandoned'
  | 'invite_accepted';

export interface WSMessage {
  event: ServerEvent;
  data: any;
}

export interface ChatMessage {
  uid: string;
  display_name: string;
  message: string;
  is_spectator?: boolean;
  timestamp?: number;
}

export interface InviteData {
  from_uid: string;
  from_name: string;
  from_avatar: string;
  game_id: string;
}

export interface InviteAcceptedData {
  room_id: string;
  game_id: string;
}
