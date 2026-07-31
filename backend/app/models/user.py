from pydantic import BaseModel, Field
from typing import Optional


class GameStats(BaseModel):
    played: int = 0
    won: int = 0
    points: int = 0


class UserSettings(BaseModel):
    language: str = "es"  # "es" | "en" — preference only; UI translation is separate work
    notify_friend_requests: bool = True
    notify_game_invites: bool = True
    hide_online_status: bool = False
    block_friend_requests: bool = False


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
    is_admin: bool = False
    badges: list[str] = []
    settings: UserSettings = Field(default_factory=UserSettings)


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    ttt_pattern: Optional[str] = None


class UserSettingsUpdate(BaseModel):
    language: Optional[str] = None
    notify_friend_requests: Optional[bool] = None
    notify_game_invites: Optional[bool] = None
    hide_online_status: Optional[bool] = None
    block_friend_requests: Optional[bool] = None
