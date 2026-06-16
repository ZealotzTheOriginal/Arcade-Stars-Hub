import uuid
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user
from app.games.registry import list_games, get_definition
from app.websocket.handler import get_room, create_room, get_active_rooms

router = APIRouter(prefix="/games", tags=["games"])


@router.get("/")
async def list_available_games():
    return list_games()


# Literal routes must come before /{game_id} to avoid parameter capture
@router.get("/rooms")
async def list_active_rooms():
    return get_active_rooms()


@router.post("/rooms")
async def create_game_room(body: dict, user: dict = Depends(get_current_user)):
    game_id = body.get("game_id")
    try:
        get_definition(game_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Game not found")

    room_id = str(uuid.uuid4())[:8].upper()
    player_info = {
        "uid": user["uid"],
        "display_name": body.get("display_name", "Player"),
        "avatar": body.get("avatar", "⭐"),
    }
    room = create_room(room_id, game_id, user["uid"], player_info)
    return {"room_id": room_id, "name": room["name"], "room": room}


@router.get("/rooms/{room_id}")
async def get_room_info(room_id: str, user: dict = Depends(get_current_user)):
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.get("/{game_id}")
async def get_game_info(game_id: str):
    try:
        return get_definition(game_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Game not found")
