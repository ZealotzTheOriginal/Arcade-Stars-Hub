from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import UserUpdate
from app.services.user_service import get_or_create_user, update_user, add_friend
from app.websocket.handler import get_online_users

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    profile = await get_or_create_user(
        uid=user["uid"],
        email=user.get("email", ""),
        display_name=user.get("name", ""),
    )
    return profile


@router.patch("/me")
async def update_me(body: UserUpdate, user: dict = Depends(get_current_user)):
    return await update_user(user["uid"], body)


@router.post("/friends/{friend_uid}")
async def add_friend_route(friend_uid: str, user: dict = Depends(get_current_user)):
    await add_friend(user["uid"], friend_uid)
    return {"ok": True}


@router.get("/online")
async def online_users(user: dict = Depends(get_current_user)):
    return [u for u in get_online_users() if u["uid"] != user["uid"]]
