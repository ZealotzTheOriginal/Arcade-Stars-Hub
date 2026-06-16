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
  | 'pong';

export interface WSMessage {
  event: ServerEvent;
  data: any;
}

export interface ChatMessage {
  uid: string;
  display_name: string;
  message: string;
  timestamp?: number;
}
