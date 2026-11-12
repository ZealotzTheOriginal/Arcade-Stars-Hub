import asyncio
from google.cloud.firestore_v1.transforms import Increment
from app.core.firebase_client import get_db
from app.websocket.manager import manager
from app.websocket.events import ServerEvent


LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000, 8000]


def _calc_level(total_points: int) -> int:
    for lvl, threshold in reversed(list(enumerate(LEVEL_THRESHOLDS, start=1))):
        if total_points >= threshold:
            return lvl
    return 1


def _award_points_sync(scores: dict[str, int], game_id: str) -> None:
    """All the blocking Firestore work for award_points, run off the event
    loop via asyncio.to_thread — the sync Firestore SDK used to run this
    directly inside an async function, freezing every other WebSocket
    connection (moves, Snake ticks, chat) for as long as each network call
    to Firestore took, right at the moment a match ends."""
    db = get_db()
    batch = db.batch()
    scored_uids = []

    for uid, pts in scores.items():
        if uid.startswith("AI_") or pts <= 0:
            continue
        user_ref = db.collection("users").document(uid)
        batch.update(user_ref, {
            "total_points": Increment(pts),
            f"game_stats.{game_id}.points": Increment(pts),
            f"game_stats.{game_id}.played": Increment(1),
        })
        scored_uids.append(uid)

    batch.commit()

    # Update levels (separate pass — reads after batch commit)
    for uid in scored_uids:
        user_ref = db.collection("users").document(uid)
        snap = user_ref.get()
        if snap.exists:
            total = snap.to_dict().get("total_points", 0)
            user_ref.update({"level": _calc_level(total)})


async def award_points(scores: dict[str, int], game_id: str):
    """Atomically increment each player's points in Firestore."""
    await asyncio.to_thread(_award_points_sync, scores, game_id)
    await manager.broadcast_global(ServerEvent.LEADERBOARD_UPDATED, {})


def _mark_win_sync(uid: str, game_id: str) -> None:
    db = get_db()
    db.collection("users").document(uid).update({
        f"game_stats.{game_id}.won": Increment(1),
    })


async def mark_win(uid: str, game_id: str):
    if uid.startswith("AI_"):
        return
    await asyncio.to_thread(_mark_win_sync, uid, game_id)
