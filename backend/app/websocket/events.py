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


class WSMessage(BaseModel):
    event: str
    data: Optional[Any] = None
