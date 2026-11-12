import asyncio
import random
from app.core.firebase_client import get_db
from app.models.user import UserProfile, UserUpdate, GameStats, UserSettings, UserSettingsUpdate

# Every function below follows the same shape: a `_..._sync` helper holds the
# actual (blocking) Firestore SDK calls, and the public `async def` just runs
# it via asyncio.to_thread. Firestore's Python SDK is synchronous — calling
# it directly inside an `async def`, as this file used to, blocks the whole
# event loop for the duration of each network round-trip, freezing every
# other WebSocket connection (in-progress games included) meanwhile.


def _get_or_create_user_sync(uid: str, email: str, display_name: str) -> UserProfile:
    db = get_db()
    ref = db.collection("users").document(uid)
    snap = ref.get()

    if snap.exists:
        data = snap.to_dict()
        return UserProfile(
            uid=uid,
            display_name=data.get("display_name", display_name),
            email=email,
            avatar=data.get("avatar", "⭐"),
            level=data.get("level", 1),
            total_points=data.get("total_points", 0),
            game_stats={k: GameStats(**v) for k, v in data.get("game_stats", {}).items()},
            friends=data.get("friends", []),
            friend_requests=data.get("friend_requests", []),
            ttt_pattern=data.get("ttt_pattern", None),
            chip_pattern=data.get("chip_pattern", None),
            is_admin=data.get("is_admin", False),
            badges=data.get("badges", []),
            settings=UserSettings(**data.get("settings", {})),
        )

    if not display_name:
        display_name = f"User{random.randint(1000, 9999)}"
    profile = UserProfile(uid=uid, display_name=display_name, email=email)
    ref.set(profile.model_dump())
    return profile


async def get_or_create_user(uid: str, email: str, display_name: str) -> UserProfile:
    return await asyncio.to_thread(_get_or_create_user_sync, uid, email, display_name)


def _update_user_sync(uid: str, update: UserUpdate) -> UserProfile:
    db = get_db()
    ref = db.collection("users").document(uid)
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    if fields:
        ref.update(fields)
    snap = ref.get()
    data = snap.to_dict()
    return UserProfile(uid=uid, **{k: v for k, v in data.items() if k != "uid"})


async def update_user(uid: str, update: UserUpdate) -> UserProfile:
    return await asyncio.to_thread(_update_user_sync, uid, update)


def _get_user_settings_sync(uid: str) -> UserSettings:
    db = get_db()
    snap = db.collection("users").document(uid).get()
    d = snap.to_dict() if snap.exists else {}
    return UserSettings(**d.get("settings", {}))


async def get_user_settings(uid: str) -> UserSettings:
    return await asyncio.to_thread(_get_user_settings_sync, uid)


def _save_user_settings_sync(uid: str, updated: UserSettings) -> None:
    db = get_db()
    db.collection("users").document(uid).update({"settings": updated.model_dump()})


async def update_user_settings(uid: str, update: UserSettingsUpdate) -> UserSettings:
    current = await get_user_settings(uid)
    patch = {k: v for k, v in update.model_dump().items() if v is not None}
    updated = current.model_copy(update=patch)
    await asyncio.to_thread(_save_user_settings_sync, uid, updated)
    return updated


def _get_leaderboard_sync(game_id: str | None, limit: int) -> list[dict]:
    db = get_db()
    col = db.collection("users")

    if game_id:
        query = col.order_by(f"game_stats.{game_id}.points", direction="DESCENDING").limit(limit)
    else:
        query = col.order_by("total_points", direction="DESCENDING").limit(limit)

    docs = query.stream()
    result = []
    rank = 1
    for doc in docs:
        if doc.id == "AI_PLAYER":
            continue
        d = doc.to_dict()
        pts = d.get(f"game_stats.{game_id}.points", 0) if game_id else d.get("total_points", 0)
        result.append({
            "uid": doc.id,
            "display_name": d.get("display_name", "Unknown"),
            "avatar": d.get("avatar", "⭐"),
            "points": pts,
            "level": d.get("level", 1),
            "rank": rank,
        })
        rank += 1
    return result


async def get_leaderboard(game_id: str | None = None, limit: int = 20) -> list[dict]:
    return await asyncio.to_thread(_get_leaderboard_sync, game_id, limit)


def _get_user_info_sync(uid: str) -> dict:
    db = get_db()
    snap = db.collection("users").document(uid).get()
    d = snap.to_dict() if snap.exists else {}
    return {"display_name": d.get("display_name", "Alguien"), "avatar": d.get("avatar", "⭐")}


async def get_user_info(uid: str) -> dict:
    """Return minimal public info (display_name, avatar) for a user."""
    return await asyncio.to_thread(_get_user_info_sync, uid)


def _add_friend_sync(uid: str, friend_uid: str) -> dict:
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayUnion, ArrayRemove

    friend_snap = db.collection("users").document(friend_uid).get()
    friend_data = friend_snap.to_dict() if friend_snap.exists else {}
    already_added_me = uid in friend_data.get("friends", [])

    # Requester sees the target in their friends list immediately
    db.collection("users").document(uid).update({"friends": ArrayUnion([friend_uid])})

    if already_added_me:
        db.collection("users").document(uid).update({"friend_requests": ArrayRemove([friend_uid])})
        db.collection("users").document(friend_uid).update({"friend_requests": ArrayRemove([uid])})
    else:
        # Target gets a pending request
        db.collection("users").document(friend_uid).update({"friend_requests": ArrayUnion([uid])})

    # Return requester info so route can send WS notification
    snap = db.collection("users").document(uid).get()
    d = snap.to_dict() if snap.exists else {}
    return {
        "display_name": d.get("display_name", "Alguien"),
        "avatar": d.get("avatar", "⭐"),
        "mutual": already_added_me,
    }


async def add_friend(uid: str, friend_uid: str) -> dict:
    """Send a friend request: add friend_uid to uid's friends, add uid to friend_uid's pending requests.

    If friend_uid already has uid in their own friends (they added us first), this
    call completes a mutual friendship instead — equivalent to accepting their
    request — and clears the now-stale pending state on both sides.
    """
    return await asyncio.to_thread(_add_friend_sync, uid, friend_uid)


def _accept_friend_request_sync(uid: str, friend_uid: str) -> None:
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayUnion, ArrayRemove
    # Remove from pending
    db.collection("users").document(uid).update({"friend_requests": ArrayRemove([friend_uid])})
    # Add to uid's friends (now mutual)
    db.collection("users").document(uid).update({"friends": ArrayUnion([friend_uid])})
    # Ensure friend_uid also has uid (they already do from the request, but be safe)
    db.collection("users").document(friend_uid).update({"friends": ArrayUnion([uid])})


async def accept_friend_request(uid: str, friend_uid: str):
    """Accept a pending friend request from friend_uid."""
    await asyncio.to_thread(_accept_friend_request_sync, uid, friend_uid)


def _reject_friend_request_sync(uid: str, friend_uid: str) -> None:
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayRemove
    # Remove from pending
    db.collection("users").document(uid).update({"friend_requests": ArrayRemove([friend_uid])})
    # Remove uid from friend_uid's friends (undo the one-sided add)
    db.collection("users").document(friend_uid).update({"friends": ArrayRemove([uid])})


async def reject_friend_request(uid: str, friend_uid: str):
    """Reject / ignore a pending friend request from friend_uid."""
    await asyncio.to_thread(_reject_friend_request_sync, uid, friend_uid)


def _is_admin_user_sync(uid: str) -> bool:
    db = get_db()
    snap = db.collection("users").document(uid).get()
    return snap.exists and snap.to_dict().get("is_admin", False)


async def is_admin_user(uid: str) -> bool:
    return await asyncio.to_thread(_is_admin_user_sync, uid)


def _get_all_users_sync() -> list[dict]:
    db = get_db()
    users = []
    for doc in db.collection("users").stream():
        d = doc.to_dict()
        users.append({
            "uid": doc.id,
            "display_name": d.get("display_name", "Unknown"),
            "avatar": d.get("avatar", "⭐"),
            "total_points": d.get("total_points", 0),
            "level": d.get("level", 1),
            "is_admin": d.get("is_admin", False),
            "badges": d.get("badges", []),
        })
    users.sort(key=lambda u: (0 if u["is_admin"] else 1, -u["total_points"]))
    return users


async def get_all_users() -> list[dict]:
    return await asyncio.to_thread(_get_all_users_sync)


def _set_admin_sync(uid: str, is_admin: bool) -> None:
    db = get_db()
    db.collection("users").document(uid).update({"is_admin": is_admin})


async def set_admin(uid: str, is_admin: bool):
    await asyncio.to_thread(_set_admin_sync, uid, is_admin)


def _set_user_avatar_sync(uid: str, avatar: str) -> None:
    db = get_db()
    db.collection("users").document(uid).update({"avatar": avatar})


async def set_user_avatar(uid: str, avatar: str):
    await asyncio.to_thread(_set_user_avatar_sync, uid, avatar)


VALID_BADGES = {"beta", "payaso", "eminencia", "hardcore"}


def _set_user_badges_sync(uid: str, clean: list[str]) -> None:
    db = get_db()
    db.collection("users").document(uid).update({"badges": clean})


async def set_user_badges(uid: str, badges: list[str]):
    clean = [b for b in badges if b in VALID_BADGES]
    await asyncio.to_thread(_set_user_badges_sync, uid, clean)


def _reset_user_points_sync(uid: str) -> None:
    db = get_db()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    if not snap.exists:
        return
    data = snap.to_dict()
    game_stats = data.get("game_stats", {})
    for game in game_stats:
        game_stats[game]["points"] = 0
    ref.update({"total_points": 0, "game_stats": game_stats})


async def reset_user_points(uid: str):
    await asyncio.to_thread(_reset_user_points_sync, uid)


def _reset_all_users_points_sync() -> None:
    db = get_db()
    for doc in db.collection("users").stream():
        data = doc.to_dict()
        game_stats = data.get("game_stats", {})
        for game in game_stats:
            game_stats[game]["points"] = 0
        doc.reference.update({"total_points": 0, "level": 1, "game_stats": game_stats})


async def reset_all_users_points():
    await asyncio.to_thread(_reset_all_users_points_sync)


def _add_user_points_sync(uid: str, points: int) -> None:
    from google.cloud.firestore_v1.transforms import Increment
    db = get_db()
    db.collection("users").document(uid).update({"total_points": Increment(points)})


async def add_user_points(uid: str, points: int):
    await asyncio.to_thread(_add_user_points_sync, uid, points)


def _remove_friend_sync(uid: str, friend_uid: str) -> None:
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayRemove
    db.collection("users").document(uid).update({
        "friends": ArrayRemove([friend_uid]),
        "friend_requests": ArrayRemove([friend_uid]),
    })
    db.collection("users").document(friend_uid).update({
        "friends": ArrayRemove([uid]),
        "friend_requests": ArrayRemove([uid]),
    })


async def remove_friend(uid: str, friend_uid: str):
    """Tear down the relationship on both sides, whatever state it's in (mutual
    friend, semi-friend either direction, or a still-pending request) — so no
    one-sided "ghost" friend entry is left behind on the other user's doc."""
    await asyncio.to_thread(_remove_friend_sync, uid, friend_uid)


def _get_friend_profiles_sync(uid: str) -> list[dict]:
    db = get_db()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    if not snap.exists:
        return []

    data = snap.to_dict()
    friend_uids: list[str] = data.get("friends", [])
    request_uids: list[str] = data.get("friend_requests", [])
    all_uids = list(dict.fromkeys(friend_uids + request_uids))  # deduplicate, preserve order
    if not all_uids:
        return []

    game_names = {
        "connect_four": "Conecta Cuatro",
        "tic_tac_toe": "Tres en Raya",
        "minesweeper": "Buscaminas",
    }

    profiles = []
    for fuid in all_uids:
        try:
            fsnap = db.collection("users").document(fuid).get()
            if not fsnap.exists:
                continue
            d = fsnap.to_dict()
            stats: dict = d.get("game_stats", {})
            best_game_id = max(stats, key=lambda g: stats[g].get("points", 0)) if stats else None

            # Three possible relationship states:
            # - "friend": mutual, both have each other in `friends`
            # - "semi_friend": we added them but they haven't reciprocated yet
            # - "pending_request": they added us and we haven't accepted yet
            is_in_my_friends = fuid in friend_uids
            is_mutual = is_in_my_friends and uid in d.get("friends", [])
            if is_in_my_friends and is_mutual:
                status = "friend"
            elif is_in_my_friends:
                status = "semi_friend"
            else:
                status = "pending_request"

            profiles.append({
                "uid": fuid,
                "display_name": d.get("display_name", "Unknown"),
                "avatar": d.get("avatar", "⭐"),
                "level": d.get("level", 1),
                "total_points": d.get("total_points", 0),
                "best_game": game_names.get(best_game_id, best_game_id) if best_game_id else None,
                "best_game_points": stats[best_game_id].get("points", 0) if best_game_id else 0,
                "status": status,
                "is_pending_request": status == "pending_request",
            })
        except Exception:
            continue
    return profiles


async def get_friend_profiles(uid: str) -> list[dict]:
    return await asyncio.to_thread(_get_friend_profiles_sync, uid)
