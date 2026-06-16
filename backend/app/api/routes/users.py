from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import UserUpdate
from app.services.user_service import get_or_create_user, update_user, add_friend, get_friend_profiles
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


@router.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    return await get_friend_profiles(user["uid"])


@router.post("/friends/{friend_uid}")
async def add_friend_route(friend_uid: str, user: dict = Depends(get_current_user)):
    await add_friend(user["uid"], friend_uid)
    return {"ok": True}


@router.get("/online")
async def online_users(user: dict = Depends(get_current_user)):
    result = []
    for u in get_online_users():
        entry = {**u, "is_me": u["uid"] == user["uid"]}
        result.append(entry)
    # Self always first, then alphabetical
    result.sort(key=lambda u: (0 if u.get("is_me") else 1, u.get("display_name", "").lower()))
    return result
