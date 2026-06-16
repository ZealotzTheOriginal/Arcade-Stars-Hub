from fastapi import APIRouter
from app.services.user_service import get_leaderboard

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("/")
async def global_leaderboard(limit: int = 20):
    return await get_leaderboard(limit=limit)


@router.get("/{game_id}")
async def game_leaderboard(game_id: str, limit: int = 20):
    return await get_leaderboard(game_id=game_id, limit=limit)
