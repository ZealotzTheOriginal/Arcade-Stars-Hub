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
    for rank, doc in enumerate(docs, start=1):
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
    return result


async def add_friend(uid: str, friend_uid: str):
    db = get_db()
    from google.cloud.firestore_v1.transforms import ArrayUnion
    db.collection("users").document(uid).update({"friends": ArrayUnion([friend_uid])})
