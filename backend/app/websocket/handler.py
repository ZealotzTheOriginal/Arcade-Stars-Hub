"""WebSocket message handler — routes events from connected clients."""
import json
import asyncio
from fastapi import WebSocket

from app.websocket.manager import manager
from app.websocket.events import ClientEvent, ServerEvent
from app.games.registry import get_game, get_definition
from app.services.deepseek import get_ai_move, AI_UID
from app.services.scoring import award_points, mark_win

# In-memory room store: room_id -> GameRoom dict
_rooms: dict[str, dict] = {}


def get_room(room_id: str) -> dict | None:
    return _rooms.get(room_id)


def create_room(room_id: str, game_id: str, host_uid: str, host_info: dict) -> dict:
    room = {
        "room_id": room_id,
        "game_id": game_id,
        "host_uid": host_uid,
        "players": [host_info],
        "status": "waiting",
        "game_state": None,
    }
    _rooms[room_id] = room
    return room


async def handle_message(ws: WebSocket, uid: str, raw: str):
    try:
        msg = json.loads(raw)
        event = msg.get("event")
        data = msg.get("data", {})
    except json.JSONDecodeError:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Invalid JSON"})
        return

    handlers = {
        ClientEvent.JOIN_ROOM: _handle_join,
        ClientEvent.LEAVE_ROOM: _handle_leave,
        ClientEvent.MAKE_MOVE: _handle_move,
        ClientEvent.CHAT_MESSAGE: _handle_chat,
        ClientEvent.ADD_AI_PLAYER: _handle_add_ai,
        ClientEvent.PING: _handle_ping,
    }
    handler = handlers.get(event)
    if handler:
        await handler(ws, uid, data)
    else:
        await manager.send(ws, ServerEvent.ERROR, {"message": f"Unknown event: {event}"})


# ── Event handlers ────────────────────────────────────────

async def _handle_join(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    game_id = data.get("game_id")
    player_info = data.get("player_info", {})

    room = _rooms.get(room_id)
    if room is None:
        if not game_id:
            await manager.send(ws, ServerEvent.ERROR, {"message": "Provide game_id to create a room"})
            return
        room = create_room(room_id, game_id, uid, {"uid": uid, **player_info})
    else:
        uids_in_room = [p["uid"] for p in room["players"]]
        if uid in uids_in_room and room["status"] == "playing":
            # Reconnect mid-game: restore WebSocket and send current state
            manager.add(room_id, uid, ws)
            await manager.send(ws, ServerEvent.ROOM_STATE, _safe_room(room))
            await manager.send(ws, ServerEvent.GAME_STARTED, {
                "players": room["players"],
                "game_state": _public_state(room["game_state"]),
            })
            return
        if uid not in uids_in_room:
            room["players"].append({"uid": uid, **player_info})

    manager.add(room_id, uid, ws)
    await manager.broadcast(room_id, ServerEvent.PLAYER_JOINED, {"player": player_info, "uid": uid})
    await manager.send(ws, ServerEvent.ROOM_STATE, _safe_room(room))

    # Auto-start if room is full
    defn = get_definition(room["game_id"])
    if len(room["players"]) >= defn.max_players and room["status"] == "waiting":
        await _start_game(room_id)


async def _handle_leave(ws: WebSocket, uid: str, data: dict):
    for room_id, room in list(_rooms.items()):
        if uid in [p["uid"] for p in room["players"]]:
            manager.remove(room_id, uid)
            await manager.broadcast(room_id, ServerEvent.PLAYER_LEFT, {"uid": uid})
            if room["status"] == "playing":
                # Keep player in room so they can reconnect
                pass
            else:
                room["players"] = [p for p in room["players"] if p["uid"] != uid]
                if not room["players"]:
                    del _rooms[room_id]
            break


async def _handle_move(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    move = data.get("move")
    room = _rooms.get(room_id)
    if not room or room["status"] != "playing":
        await manager.send(ws, ServerEvent.ERROR, {"message": "Room not in play"})
        return

    game = get_game(room["game_id"])
    try:
        new_state = game.apply_move(room["game_state"], uid, move)
    except ValueError as e:
        await manager.send(ws, ServerEvent.ERROR, {"message": str(e)})
        return

    room["game_state"] = new_state
    await manager.broadcast(room_id, ServerEvent.MOVE_MADE, {
        "move": move,
        "uid": uid,
        "game_state": _public_state(new_state),
    })

    if game.is_terminal(new_state):
        await _end_game(room_id, room, game, new_state)
        return

    # If next player is AI, trigger its move
    next_uid = new_state.get("current_turn")
    if next_uid == AI_UID:
        asyncio.create_task(_do_ai_move(room_id))


async def _handle_chat(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    message = data.get("message", "").strip()[:300]
    sender = data.get("display_name", "Player")
    if room_id and message:
        await manager.broadcast(room_id, ServerEvent.CHAT_MESSAGE, {
            "uid": uid,
            "display_name": sender,
            "message": message,
        })


async def _handle_ping(ws: WebSocket, uid: str, data: dict):
    await manager.send(ws, ServerEvent.PONG, {})


async def _handle_add_ai(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    room = _rooms.get(room_id)
    if not room or room["host_uid"] != uid:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Only the host can add AI"})
        return

    ai_info = {"uid": AI_UID, "display_name": "DeepSeek AI", "avatar": "🤖", "is_ai": True}
    room["players"].append(ai_info)
    await manager.broadcast(room_id, ServerEvent.PLAYER_JOINED, {"player": ai_info, "uid": AI_UID})

    defn = get_definition(room["game_id"])
    if len(room["players"]) >= defn.max_players and room["status"] == "waiting":
        await _start_game(room_id)


# ── Internal helpers ──────────────────────────────────────

async def _start_game(room_id: str):
    room = _rooms[room_id]
    game = get_game(room["game_id"])
    player_uids = [p["uid"] for p in room["players"]]
    room["game_state"] = game.get_initial_state(player_uids)
    room["status"] = "playing"
    await manager.broadcast(room_id, ServerEvent.GAME_STARTED, {
        "game_state": _public_state(room["game_state"]),
        "players": room["players"],
    })

    if room["game_state"].get("current_turn") == AI_UID:
        asyncio.create_task(_do_ai_move(room_id))


async def _do_ai_move(room_id: str):
    room = _rooms.get(room_id)
    if not room or room["status"] != "playing":
        return
    game = get_game(room["game_id"])
    await manager.broadcast(room_id, ServerEvent.AI_THINKING, {})
    await asyncio.sleep(0.8)  # feel natural

    try:
        move = await get_ai_move(game, room["game_state"])
        new_state = game.apply_move(room["game_state"], AI_UID, move)
    except Exception:
        return

    room["game_state"] = new_state
    await manager.broadcast(room_id, ServerEvent.MOVE_MADE, {
        "move": move,
        "uid": AI_UID,
        "game_state": _public_state(new_state),
    })

    if game.is_terminal(new_state):
        await _end_game(room_id, room, game, new_state)


async def _end_game(room_id: str, room: dict, game, state: dict):
    room["status"] = "finished"
    scores = game.get_scores(state)
    winner = game.get_winner(state)

    await manager.broadcast(room_id, ServerEvent.GAME_OVER, {
        "winner": winner,
        "scores": scores,
        "game_state": _public_state(state),
    })

    # Persist scores
    asyncio.create_task(award_points(scores, room["game_id"]))
    if winner and winner != AI_UID:
        asyncio.create_task(mark_win(winner, room["game_id"]))


def _safe_room(room: dict) -> dict:
    return {k: v for k, v in room.items() if k != "game_state"}


def _public_state(state: dict) -> dict:
    """Strip mine positions from Minesweeper state sent to clients."""
    if "board" in state and state.get("board") is not None:
        board = state["board"]
        revealed = state.get("revealed", [])
        # Only send mine info for revealed cells
        public_board = [
            [cell if revealed[r][c] else -2 for c, cell in enumerate(row)]
            for r, row in enumerate(board)
        ] if revealed else board
        return {**state, "board": public_board}
    return state
