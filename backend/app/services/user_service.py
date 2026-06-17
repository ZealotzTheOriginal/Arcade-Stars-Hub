import random
from app.core.firebase_client import get_db
from app.models.user import UserProfile, UserUpdate, GameStats


async def get_or_create_user(uid: str, email: str, display_name: str) -> UserProfile:
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
        )

    if not display_name:
        display_name = f"User{random.randint(1000, 9999)}"
    profile = UserProfile(uid=uid, display_name=display_name, email=email)
    ref.set(profile.model_dump())
    return profile


async def update_user(uid: str, update: UserUpdate) -> UserProfile:
    db = get_db()
    ref = db.collection("users").document(uid)
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    if fields:
        ref.update(fields)
    snap = ref.get()
    data = snap.to_dict()
    return UserProfile(uid=uid, **{k: v for k, v in data.items() if k != "uid"})


async def get_leaderboard(game_id: str | None = None, limit: int = 20) -> list[dict]:
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


async def get_user_info(uid: str) -> dict:
    """Return minimal public info (display_name, avatar) for a user."""
    db = get_db()
    snap = db.collection("users").document(uid).get()
    d = snap.to_dict() if snap.exists else {}
    return {"display_name": d.get("display_name", "Alguien"), "avatar": d.get("avatar", "⭐")}


async def add_friend(uid: str, friend_uid: str) -> dict:
    """Send a friend request: add friend_uid to uid's friends, add uid to friend_uid's pending requests."""
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayUnion
    # Requester sees the target in their friends list immediately
    db.collection("users").document(uid).update({"friends": ArrayUnion([friend_uid])})
    # Target gets a pending request
    db.collection("users").document(friend_uid).update({"friend_requests": ArrayUnion([uid])})
    # Return requester info so route can send WS notification
    snap = db.collection("users").document(uid).get()
    d = snap.to_dict() if snap.exists else {}
    return {"display_name": d.get("display_name", "Alguien"), "avatar": d.get("avatar", "⭐")}


async def accept_friend_request(uid: str, friend_uid: str):
    """Accept a pending friend request from friend_uid."""
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayUnion, ArrayRemove
    # Remove from pending
    db.collection("users").document(uid).update({"friend_requests": ArrayRemove([friend_uid])})
    # Add to uid's friends (now mutual)
    db.collection("users").document(uid).update({"friends": ArrayUnion([friend_uid])})
    # Ensure friend_uid also has uid (they already do from the request, but be safe)
    db.collection("users").document(friend_uid).update({"friends": ArrayUnion([uid])})


async def reject_friend_request(uid: str, friend_uid: str):
    """Reject / ignore a pending friend request from friend_uid."""
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayRemove
    # Remove from pending
    db.collection("users").document(uid).update({"friend_requests": ArrayRemove([friend_uid])})
    # Remove uid from friend_uid's friends (undo the one-sided add)
    db.collection("users").document(friend_uid).update({"friends": ArrayRemove([uid])})


async def remove_friend(uid: str, friend_uid: str):
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayRemove
    db.collection("users").document(uid).update({"friends": ArrayRemove([friend_uid])})


async def get_friend_profiles(uid: str) -> list[dict]:
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
            profiles.append({
                "uid": fuid,
                "display_name": d.get("display_name", "Unknown"),
                "avatar": d.get("avatar", "⭐"),
                "level": d.get("level", 1),
                "total_points": d.get("total_points", 0),
                "best_game": game_names.get(best_game_id, best_game_id) if best_game_id else None,
                "best_game_points": stats[best_game_id].get("points", 0) if best_game_id else 0,
                "is_pending_request": fuid in request_uids and fuid not in friend_uids,
            })
        except Exception:
            continue
    return profiles
