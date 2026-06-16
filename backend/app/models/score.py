from pydantic import BaseModel
from datetime import datetime


class ScoreEvent(BaseModel):
    uid: str
    game_id: str
    points: int
    reason: str = ""


class LeaderboardEntry(BaseModel):
    uid: str
    display_name: str
    avatar: str
    points: int
    rank: int
