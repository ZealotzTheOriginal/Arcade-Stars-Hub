from enum import Enum
from pydantic import BaseModel
from typing import Any, Optional


# ── Incoming event types (client → server) ──────────────
class ClientEvent(str, Enum):
    JOIN_ROOM = "join_room"
    LEAVE_ROOM = "leave_room"
    MAKE_MOVE = "make_move"
    CHAT_MESSAGE = "chat_message"
    REQUEST_AI_MOVE = "request_ai_move"
    ADD_AI_PLAYER = "add_ai_player"
    PING = "ping"
    SPECTATE_ROOM = "spectate_room"
    REQUEST_REMATCH = "request_rematch"
    SEND_INVITE = "send_invite"
    RESPOND_INVITE = "respond_invite"
    REGISTER_PRESENCE = "register_presence"
    ABANDON_GAME = "abandon_game"
    GLOBAL_CHAT = "global_chat"
    START_GAME = "start_game"
    SET_PLAYER_COLOR = "set_player_color"
    SET_GAME_MODE = "set_game_mode"
    ASSIGN_TEAM = "assign_team"
    SET_MAX_PLAYERS = "set_max_players"
    KICK_PLAYER = "kick_player"
    REQUEST_COLOR_SWAP = "request_color_swap"
    RESPOND_COLOR_SWAP = "respond_color_swap"
    TRANSFER_LEADER = "transfer_leader"
    SET_TTT_PATTERN = "set_ttt_pattern"
    SET_MS_BOARD_SIZE = "set_ms_board_size"


# ── Outgoing event types (server → client) ──────────────
class ServerEvent(str, Enum):
    ROOM_STATE = "room_state"
    PLAYER_JOINED = "player_joined"
    PLAYER_LEFT = "player_left"
    GAME_STARTED = "game_started"
    MOVE_MADE = "move_made"
    GAME_OVER = "game_over"
    CHAT_MESSAGE = "chat_message"
    AI_THINKING = "ai_thinking"
    ERROR = "error"
    PONG = "pong"
    ROOM_CLOSED = "room_closed"
    REMATCH_VOTE = "rematch_vote"
    GAME_RESET = "game_reset"
    INVITE_RECEIVED = "invite_received"
    INVITE_RESPONSE = "invite_response"
    SPECTATOR_JOINED = "spectator_joined"
    SPECTATOR_LEFT = "spectator_left"
    PLAYER_DISCONNECTED = "player_disconnected"
    PLAYER_RECONNECTED = "player_reconnected"
    GAME_ABANDONED = "game_abandoned"
    INVITE_ACCEPTED = "invite_accepted"
    GLOBAL_CHAT_MESSAGE = "global_chat_message"
    FRIEND_REQUEST = "friend_request"
    FRIEND_REQUEST_REJECTED = "friend_request_rejected"
    FRIEND_REMOVED = "friend_removed"
    KICKED = "kicked"
    COLOR_SWAP_REQUEST = "color_swap_request"
    COLOR_SWAP_DECLINED = "color_swap_declined"
    LOBBY_UPDATE = "lobby_update"
    LEADERBOARD_UPDATED = "leaderboard_updated"
    INVITE_FAILED = "invite_failed"


class WSMessage(BaseModel):
    event: str
    data: Optional[Any] = None
