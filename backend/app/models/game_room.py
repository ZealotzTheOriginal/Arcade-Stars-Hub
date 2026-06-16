from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum
import uuid


class RoomStatus(str, Enum):
    WAITING = "waiting"
    PLAYING = "playing"
    FINISHED = "finished"


class PlayerInfo(BaseModel):
    uid: str
    display_name: str
    avatar: str = "⭐"
    is_ai: bool = False


class GameRoom(BaseModel):
    room_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8].upper())
    game_id: str
    host_uid: str
    players: list[PlayerInfo] = []
    status: RoomStatus = RoomStatus.WAITING
    max_players: int = 2
    game_state: Optional[Any] = None
    allow_ai: bool = True


class GameDefinition(BaseModel):
    id: str
    name: str
    description: str
    category: str
    thumbnail: str
    max_players: int
    has_ai: bool
    min_players: int = 2
