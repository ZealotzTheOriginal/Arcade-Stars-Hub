from google.cloud.firestore_v1 import AsyncClient
from google.cloud.firestore_v1.transforms import Increment
from app.core.firebase_client import get_db


LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000, 8000]


def _calc_level(total_points: int) -> int:
    for lvl, threshold in reversed(list(enumerate(LEVEL_THRESHOLDS, start=1))):
        if total_points >= threshold:
            return lvl
    return 1


async def award_points(scores: dict[str, int], game_id: str):
    """Atomically increment each player's points in Firestore."""
    db = get_db()
    batch = db.batch()

    for uid, pts in scores.items():
        if uid == "AI_PLAYER" or pts <= 0:
            continue
        user_ref = db.collection("users").document(uid)
        batch.update(user_ref, {
            "total_points": Increment(pts),
            f"game_stats.{game_id}.points": Increment(pts),
            f"game_stats.{game_id}.played": Increment(1),
        })

    batch.commit()

    # Update levels (separate pass — reads after batch commit)
    for uid in scores:
        if uid == "AI_PLAYER":
            continue
        user_ref = db.collection("users").document(uid)
        snap = user_ref.get()
        if snap.exists:
            total = snap.to_dict().get("total_points", 0)
            new_level = _calc_level(total)
            user_ref.update({"level": new_level})


async def mark_win(uid: str, game_id: str):
    if uid == "AI_PLAYER":
        return
    db = get_db()
    db.collection("users").document(uid).update({
        f"game_stats.{game_id}.won": Increment(1),
    })
