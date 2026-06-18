from pydantic import BaseModel
from typing import Optional


class GameStats(BaseModel):
    played: int = 0
    won: int = 0
    points: int = 0


class UserProfile(BaseModel):
    uid: str
    display_name: str
    email: str
    avatar: str = "⭐"
    level: int = 1
    total_points: int = 0
    game_stats: dict[str, GameStats] = {}
    friends: list[str] = []
    friend_requests: list[str] = []
    ttt_pattern: Optional[str] = None


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    ttt_pattern: Optional[str] = None
