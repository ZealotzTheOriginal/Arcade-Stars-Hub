"""WebSocket message handler — routes events from connected clients."""
import json
import time
import uuid
import asyncio
import random
from fastapi import WebSocket

from app.websocket.manager import manager
from app.websocket.events import ClientEvent, ServerEvent
from app.games.registry import get_game, get_definition
from app.services.deepseek import get_ai_move, AI_UID
from app.services.scoring import award_points, mark_win
from app.services.room_names import pick_room_name

# In-memory room store: room_id -> GameRoom dict
_rooms: dict[str, dict] = {}

# Global presence: uid -> {display_name, avatar, room_id}
_presence: dict[str, dict] = {}

ROOM_TIMEOUT_SECONDS = 600  # 10 minutes

_DEFAULT_COLORS = ["#ef4444", "#3b82f6", "#eab308", "#22c55e", "#a855f7", "#f97316", "#ec4899", "#06b6d4"]


def _assign_default_color(room: dict, uid: str):
    taken = set(room.get("player_colors", {}).values())
    for color in _DEFAULT_COLORS:
        if color not in taken:
            room.setdefault("player_colors", {})[uid] = color
            return
    room.setdefault("player_colors", {})[uid] = _DEFAULT_COLORS[0]

# ── AI personality message pools ──────────────────────────────
_AI_POOL_START = [
    "Bienvenido a mi juego. Intenta no manchar el suelo con tus lágrimas.",
    "Te daré un poco de ventaja, solo para que la historia sea emocionante.",
    "¿Quieres el primer puesto? El peaje es intentar ganarme, y hoy no acepto propinas.",
    "Mírame bien ahora, porque cuando esto empiece no vas a volver a verme el pelo.",
    "Hagamos una apuesta: si gano yo, te sorprendes. Si ganas tú... despierta del sueño.",
    "Me encanta el olor a victoria por la mañana. Y a todas horas, la verdad.",
]

# Respuesta cuando el rival escribe en el chat (mandarlo a callar)
_AI_POOL_SILENCE = [
    "Menos charla y más nivel, que me estás durmiendo con tanto discurso.",
    "Ahorra saliva para cuando llores, que te va a hacer falta.",
    "¿Sientes eso? Es el sonido de tu boca cerrándose ante mi superioridad.",
    "Tu estrategia habla mucho, pero tus resultados no dicen nada.",
    "Shh. Estoy intentando concentrarme y no me ayuda escucharte.",
    "Avísame cuando empieces a jugar en serio, ¿vale?",
    "¿Vienes a competir o a dar una conferencia? Decide ya.",
    "Deja que tu juego hable por ti, porque de momento está mudo.",
]

# Respuesta cuando el rival gana (fingir que fue suerte)
_AI_POOL_LUCK = [
    "Felicidades. Has gastado toda la suerte de tu vida en una sola jugada.",
    "Disfruta del milagro, porque los rayos no caen dos veces en el mismo sitio.",
    "Hasta un reloj roto acierta dos veces al día. Hoy te ha tocado a ti.",
    "Eso no ha sido talento, ha sido un error en la Matrix a tu favor.",
    "Vaya potra. Compra un boleto de lotería antes de que se te pase el efecto.",
    "Qué tierno. Crees que lo has hecho a propósito.",
    "Bonita casualidad. Ahora intenta repetirlo.",
    "El universo te ha regalado esa jugada porque te tenía lástima.",
]

# Respuesta cuando el rival tarda demasiado en jugar
_AI_POOL_BORED = [
    "Oye, ¿vas a jugar o me da tiempo a echarme una siesta?",
    "¿Esto es todo lo que tienes? Me habían prometido un reto de verdad.",
    "Voy a empezar a jugar con una sola mano para que esto sea más justo.",
    "Me estoy haciendo viejo esperando a que me pongas las cosas difíciles.",
    "Si lo sé, me quedo durmiendo. En serio.",
    "Pensé que venía a competir, no a hacer de niñera. Espabila.",
    "Mi mayor rival hoy estás siendo tú... y el sueño que me estás dando.",
    "Estoy ganando tan fácil que esto ya parece un tutorial.",
]

# Frases cortas de desprecio (jugada rápida del rival o comentario espontáneo)
_AI_POOL_SHORT = [
    "¿Me avisas cuando empiece la parte difícil?",
    "Eso no me lo esperaba. Que hayas hecho algo tan mediocre.",
    "Suerte de principiante. No te acostumbres.",
    "¿Ese era tu gran plan? Decepcionante.",
    "Siguiente.",
    "Previsible.",
    "Vaya.",
]

_AI_POOL_WIN = [
    "Te lo advertí. El trono solo tiene sitio para uno.",
    "No te sientas mal, perder contra alguien como yo sigue siendo un honor.",
    "Guarda el recuerdo de esta partida. Es lo más cerca que vas a estar de ganarme.",
    "Fue divertido mientras duró... bueno, divertido para mí, claro.",
    "Anota otra victoria en mi cuenta. Me estoy quedando sin espacio para tantos trofeos.",
]

# room_id -> Task: boredom check that fires if the human doesn't move in time
_boredom_tasks: dict[str, "asyncio.Task[None]"] = {}


# ── Public accessors ──────────────────────────────────────

def get_room(room_id: str) -> dict | None:
    return _rooms.get(room_id)


def create_room(room_id: str, game_id: str, host_uid: str) -> dict:
    existing_names = {r.get("name", "") for r in _rooms.values()}
    defn = get_definition(game_id)
    room = {
        "room_id": room_id,
        "name": pick_room_name(existing_names),
        "game_id": game_id,
        "host_uid": host_uid,
        "leader_uid": host_uid,
        "min_players": defn.min_players,
        "max_players": defn.max_players,
        "players": [],
        "spectators": [],
        "status": "waiting",
        "game_state": None,
        "last_activity": time.time(),
        "rematch_votes": [],
        "player_colors": {},
        "game_mode": "ffa",
        "teams": {"a": [], "b": []},
    }
    _rooms[room_id] = room
    return room


def _is_ai_uid(room: dict, uid: str) -> bool:
    return any(p["uid"] == uid and p.get("is_ai") for p in room.get("players", []))


def _reassign_leader(room: dict) -> None:
    """Ensure leader_uid is always a human player. Called when a player leaves."""
    current_leader = room.get("leader_uid")
    players = room.get("players", [])
    if any(p["uid"] == current_leader and not p.get("is_ai") for p in players):
        return  # current leader is still a human in the room
    for p in players:
        if not p.get("is_ai"):
            room["leader_uid"] = p["uid"]
            return


def get_active_rooms() -> list[dict]:
    return [
        {
            "room_id": r["room_id"],
            "name": r.get("name", r["room_id"]),
            "game_id": r["game_id"],
            "status": r["status"],
            "players": [
                {"uid": p["uid"], "display_name": p.get("display_name", ""), "avatar": p.get("avatar", "⭐")}
                for p in r["players"]
            ],
            "spectators_count": len(r.get("spectators", [])),
            "last_activity": r.get("last_activity", 0),
        }
        for r in _rooms.values()
        if manager.players_in_room(r["room_id"])
    ]


def get_online_users() -> list[dict]:
    return [
        {
            "uid": uid,
            "display_name": info.get("display_name", ""),
            "avatar": info.get("avatar", "⭐"),
            "room_id": info.get("room_id"),
        }
        for uid, info in _presence.items()
    ]


def register_presence(uid: str, display_name: str, avatar: str):
    _presence[uid] = {"display_name": display_name, "avatar": avatar, "room_id": None}


def unregister_presence(uid: str):
    _presence.pop(uid, None)


async def cleanup_stale_rooms():
    """Close rooms that are stale or abandoned."""
    now = time.time()
    for room_id in list(_rooms.keys()):
        room = _rooms.get(room_id)
        if not room:
            continue
        # Normal inactivity timeout
        if now - room.get("last_activity", now) > ROOM_TIMEOUT_SECONDS:
            await _close_room(room_id, "Sala cerrada por inactividad")
            continue
        # Playing rooms with no active connections → close after 2-minute grace period
        if room["status"] == "playing" and not manager.players_in_room(room_id):
            if now - room.get("last_activity", now) > 120:
                await _close_room(room_id, "Sala cerrada: partida abandonada")


async def _close_room_after(room_id: str, delay: float, reason: str = "Sala cerrada"):
    await asyncio.sleep(delay)
    await _close_room(room_id, reason)


async def _close_room(room_id: str, reason: str = "Sala cerrada"):
    if room_id not in _rooms:
        return
    task = _boredom_tasks.pop(room_id, None)
    if task:
        task.cancel()
    await manager.broadcast(room_id, ServerEvent.ROOM_CLOSED, {"reason": reason})
    del _rooms[room_id]


# ── Main dispatcher ───────────────────────────────────────

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
        ClientEvent.SPECTATE_ROOM: _handle_spectate,
        ClientEvent.REQUEST_REMATCH: _handle_rematch,
        ClientEvent.SEND_INVITE: _handle_send_invite,
        ClientEvent.RESPOND_INVITE: _handle_respond_invite,
        ClientEvent.REGISTER_PRESENCE: _handle_register_presence,
        ClientEvent.ABANDON_GAME: _handle_abandon,
        ClientEvent.GLOBAL_CHAT: _handle_global_chat,
        ClientEvent.START_GAME: _handle_start_game,
        ClientEvent.SET_PLAYER_COLOR: _handle_set_player_color,
        ClientEvent.SET_GAME_MODE: _handle_set_game_mode,
        ClientEvent.ASSIGN_TEAM: _handle_assign_team,
        ClientEvent.SET_MAX_PLAYERS: _handle_set_max_players,
        ClientEvent.KICK_PLAYER: _handle_kick_player,
        ClientEvent.REQUEST_COLOR_SWAP: _handle_request_color_swap,
        ClientEvent.RESPOND_COLOR_SWAP: _handle_respond_color_swap,
    }
    handler = handlers.get(event)
    if handler:
        await handler(ws, uid, data)


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
        room = create_room(room_id, game_id, uid)

    uids_in_room = [p["uid"] for p in room["players"]]

    # ── Reconnect to in-progress game ────────────────────
    if uid in uids_in_room and room["status"] in ("playing", "finished"):
        manager.add(room_id, uid, ws)
        stored = next((p for p in room["players"] if p["uid"] == uid), {})
        await manager.broadcast(room_id, ServerEvent.PLAYER_RECONNECTED, {
            "uid": uid,
            "display_name": stored.get("display_name", "Jugador"),
        }, exclude_uid=uid)
        await manager.send(ws, ServerEvent.ROOM_STATE, _safe_room(room))
        if room["status"] == "playing":
            await manager.send(ws, ServerEvent.GAME_STARTED, {
                "players": room["players"],
                "game_state": _public_state(room["game_state"]),
                "reconnected": True,
            })
        else:
            game = get_game(room["game_id"])
            await manager.send(ws, ServerEvent.GAME_OVER, {
                "winner": game.get_winner(room["game_state"]),
                "scores": game.get_scores(room["game_state"]),
                "game_state": _public_state(room["game_state"]),
                "rematch_votes": room.get("rematch_votes", []),
            })
        return

    # ── Re-joining lobby (reconnect WS only, no re-broadcast) ────────────
    if uid in uids_in_room and room["status"] == "waiting":
        manager.add(room_id, uid, ws)
        await manager.send(ws, ServerEvent.ROOM_STATE, _safe_room(room))
        return

    # ── Room full → auto-spectate ─────────────────────────
    player_count = len([p for p in room["players"] if not p.get("is_ai")])
    max_p = room.get("max_players", 2)
    if player_count >= max_p and uid not in uids_in_room:
        await _spectate_room(ws, uid, room_id, player_info)
        return

    # ── Add new player (handles spectator → player switch too) ───────────
    if uid not in uids_in_room:
        if any(s["uid"] == uid for s in room.get("spectators", [])):
            room["spectators"] = [s for s in room["spectators"] if s["uid"] != uid]
            await manager.broadcast(room_id, ServerEvent.SPECTATOR_LEFT, {"uid": uid}, exclude_uid=uid)
        room["players"].append({"uid": uid, **player_info})
        _assign_default_color(room, uid)

    room["last_activity"] = time.time()
    if uid in _presence:
        _presence[uid]["room_id"] = room_id

    manager.add(room_id, uid, ws)
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_leave(ws: WebSocket, uid: str, data: dict):
    left_room_id: str | None = None

    # Remove from spectators if applicable
    for room_id, room in list(_rooms.items()):
        if uid in [s["uid"] for s in room.get("spectators", [])]:
            room["spectators"] = [s for s in room["spectators"] if s["uid"] != uid]
            manager.remove(room_id, uid)
            await manager.broadcast(room_id, ServerEvent.SPECTATOR_LEFT, {"uid": uid})
            left_room_id = room_id
            break

    if left_room_id is None:
        # Remove from players
        for room_id, room in list(_rooms.items()):
            if uid in [p["uid"] for p in room["players"]]:
                player_info = next((p for p in room["players"] if p["uid"] == uid), {})
                manager.remove(room_id, uid)
                if room["status"] == "playing":
                    # Keep slot for reconnect; notify others it's a temporary disconnect
                    await manager.broadcast(room_id, ServerEvent.PLAYER_DISCONNECTED, {
                        "uid": uid,
                        "display_name": player_info.get("display_name", "Jugador"),
                    })
                else:
                    await manager.broadcast(room_id, ServerEvent.PLAYER_LEFT, {"uid": uid})
                    room["players"] = [p for p in room["players"] if p["uid"] != uid]
                    if not room["players"] or all(p.get("is_ai") for p in room["players"]):
                        _rooms.pop(room_id, None)
                    else:
                        _reassign_leader(room)
                if uid in _presence:
                    _presence[uid]["room_id"] = None
                left_room_id = room_id
                break

    # If the room now has zero WS connections, decide what to do with it
    if left_room_id:
        await _auto_close_if_empty(left_room_id)


async def _auto_close_if_empty(room_id: str):
    """Close a room when no players remain connected, evicting any spectators.

    Spectators do not count as "active" for this check — a room kept alive
    only by spectators is one where both players have already left, so there
    is nothing left to watch.
    """
    room = _rooms.get(room_id)
    if not room:
        return

    connected_uids = set(manager.players_in_room(room_id))
    player_uids = {p["uid"] for p in room.get("players", [])}

    # If at least one player is still connected, keep the room alive
    if connected_uids & player_uids:
        return

    # No players remain — broadcast ROOM_CLOSED (reaches spectators too) and delete
    await _close_room(room_id, "Los jugadores han abandonado la sala")


async def _handle_move(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    move = data.get("move")
    room = _rooms.get(room_id)
    if not room or room["status"] != "playing":
        await manager.send(ws, ServerEvent.ERROR, {"message": "Room not in play"})
        return

    # Human moved — cancel any pending boredom check
    boredom_task = _boredom_tasks.pop(room_id, None)
    if boredom_task:
        boredom_task.cancel()

    # Detect suspiciously quick moves (only after AI has had a turn)
    turn_start = room.pop("human_turn_start", None)
    has_ai = any(p.get("is_ai") for p in room.get("players", []))
    if has_ai and turn_start is not None and (time.time() - turn_start) < 2.5 and random.random() < 0.35:
        asyncio.create_task(_ai_chat(room_id, random.choice(_AI_POOL_SHORT), delay=1.0))

    game = get_game(room["game_id"])
    try:
        new_state = game.apply_move(room["game_state"], uid, move)
    except ValueError as e:
        await manager.send(ws, ServerEvent.ERROR, {"message": str(e)})
        return

    room["game_state"] = new_state
    room["last_activity"] = time.time()
    await manager.broadcast(room_id, ServerEvent.MOVE_MADE, {
        "move": move,
        "uid": uid,
        "game_state": _public_state(new_state),
    })

    if game.is_terminal(new_state):
        await _end_game(room_id, room, game, new_state)
        return

    next_uid = new_state.get("current_turn")
    if next_uid and _is_ai_uid(room, next_uid):
        asyncio.create_task(_do_ai_move(room_id))


async def _handle_chat(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    message = data.get("message", "").strip()[:300]
    sender = data.get("display_name", "Player")
    if not room_id or not message:
        return

    room = _rooms.get(room_id)
    if not room:
        return

    is_spectator = uid in [s["uid"] for s in room.get("spectators", [])]
    if is_spectator:
        sender = f"[Espectador] {sender}"

    room["last_activity"] = time.time()
    await manager.broadcast(room_id, ServerEvent.CHAT_MESSAGE, {
        "uid": uid,
        "display_name": sender,
        "message": message,
        "is_spectator": is_spectator,
    })

    if uid != AI_UID and any(p.get("is_ai") for p in room.get("players", [])) and random.random() < 0.65:
        asyncio.create_task(
            _ai_chat(room_id, random.choice(_AI_POOL_SILENCE), delay=random.uniform(2.0, 3.5))
        )


async def _handle_ping(ws: WebSocket, uid: str, data: dict):
    await manager.send(ws, ServerEvent.PONG, {})


async def _handle_add_ai(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    room = _rooms.get(room_id)
    if not room or room.get("leader_uid") != uid:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Solo el líder puede añadir IA"})
        return
    if room["status"] != "waiting":
        return
    if len(room["players"]) >= room.get("max_players", 2):
        await manager.send(ws, ServerEvent.ERROR, {"message": "La sala está llena"})
        return

    ai_uid = f"AI_{uuid.uuid4().hex[:8].upper()}"
    ai_info = {"uid": ai_uid, "display_name": "Arcade IA", "avatar": "🤖", "is_ai": True}
    room["players"].append(ai_info)
    _assign_default_color(room, ai_uid)
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_spectate(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    spectator_info = data.get("spectator_info", {})
    await _spectate_room(ws, uid, room_id, spectator_info)


async def _spectate_room(ws: WebSocket, uid: str, room_id: str, spectator_info: dict):
    room = _rooms.get(room_id)
    if not room:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Room not found"})
        return

    spec_info = {"uid": uid, **spectator_info}
    if uid not in [s["uid"] for s in room.get("spectators", [])]:
        room.setdefault("spectators", []).append(spec_info)

    manager.add(room_id, uid, ws)
    await manager.send(ws, ServerEvent.ROOM_STATE, _safe_room(room))
    await manager.broadcast(room_id, ServerEvent.SPECTATOR_JOINED, {"spectator": spec_info, "uid": uid}, exclude_uid=uid)

    if room["status"] == "playing" and room["game_state"]:
        await manager.send(ws, ServerEvent.GAME_STARTED, {
            "players": room["players"],
            "game_state": _public_state(room["game_state"]),
        })
    elif room["status"] == "finished" and room["game_state"]:
        game = get_game(room["game_id"])
        await manager.send(ws, ServerEvent.GAME_OVER, {
            "winner": game.get_winner(room["game_state"]),
            "scores": game.get_scores(room["game_state"]),
            "game_state": _public_state(room["game_state"]),
            "rematch_votes": room.get("rematch_votes", []),
        })


async def _handle_rematch(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    room = _rooms.get(room_id)
    if not room or room["status"] != "finished":
        await manager.send(ws, ServerEvent.ERROR, {"message": "No game to rematch"})
        return

    if uid not in room.get("rematch_votes", []):
        room["rematch_votes"].append(uid)

    human_players = [p["uid"] for p in room["players"] if not p.get("is_ai")]
    await manager.broadcast(room_id, ServerEvent.REMATCH_VOTE, {
        "votes": room["rematch_votes"],
        "needed": len(human_players),
    })

    if all(p in room["rematch_votes"] for p in human_players):
        room["rematch_votes"] = []
        room["status"] = "waiting"
        room["game_state"] = None
        room["last_activity"] = time.time()
        await manager.broadcast(room_id, ServerEvent.GAME_RESET, {"players": room["players"]})

        defn = get_definition(room["game_id"])
        if len(room["players"]) >= defn.max_players:
            await _start_game(room_id)


async def _handle_send_invite(ws: WebSocket, uid: str, data: dict):
    to_uid = data.get("to_uid")
    game_id = data.get("game_id")
    room_id = data.get("room_id")  # optional: invite into an existing waiting room
    if not to_uid or not game_id:
        return

    info = _presence.get(uid, {})
    payload: dict = {
        "from_uid": uid,
        "from_name": info.get("display_name", "Alguien"),
        "from_avatar": info.get("avatar", "⭐"),
        "game_id": game_id,
    }
    if room_id:
        payload["room_id"] = room_id
    await manager.send_direct(to_uid, ServerEvent.INVITE_RECEIVED, payload)


async def _handle_respond_invite(ws: WebSocket, uid: str, data: dict):
    to_uid = data.get("to_uid")
    accepted = data.get("accepted", False)
    game_id = data.get("game_id")
    existing_room_id = data.get("room_id")
    if not to_uid:
        return

    accepter_info = _presence.get(uid, {})

    if not accepted:
        await manager.send_direct(to_uid, ServerEvent.INVITE_RESPONSE, {
            "from_uid": uid,
            "from_name": accepter_info.get("display_name", "Alguien"),
            "accepted": False,
        })
        return

    # If inviting into an existing waiting room, skip room creation
    if existing_room_id and existing_room_id in _rooms:
        room = _rooms[existing_room_id]
        payload = {"room_id": existing_room_id, "game_id": room["game_id"], "room_name": room.get("name", "")}
        await manager.send_direct(to_uid, ServerEvent.INVITE_ACCEPTED, payload)
        await manager.send_direct(uid, ServerEvent.INVITE_ACCEPTED, payload)
        return

    # Create room with inviter as leader; both players join via join_room after animation
    room_id = str(uuid.uuid4())[:8].upper()
    create_room(room_id, game_id, to_uid)

    room = _rooms[room_id]
    payload = {"room_id": room_id, "game_id": game_id, "room_name": room["name"]}
    await manager.send_direct(to_uid, ServerEvent.INVITE_ACCEPTED, payload)
    await manager.send_direct(uid, ServerEvent.INVITE_ACCEPTED, payload)


async def _handle_global_chat(ws: WebSocket, uid: str, data: dict):
    text = str(data.get("text", "")).strip()
    if not text or len(text) > 200:
        return
    presence = _presence.get(uid, {})
    await manager.broadcast_global(ServerEvent.GLOBAL_CHAT_MESSAGE, {
        "uid": uid,
        "display_name": presence.get("display_name", "Jugador"),
        "avatar": presence.get("avatar", "⭐"),
        "text": text,
        "ts": int(time.time() * 1000),
    })


async def _handle_register_presence(ws: WebSocket, uid: str, data: dict):
    display_name = data.get("display_name", "")
    avatar = data.get("avatar", "⭐")
    register_presence(uid, display_name, avatar)
    manager.register_direct(uid, ws)


async def _handle_abandon(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    room = _rooms.get(room_id)
    if not room or room["status"] != "playing":
        return
    if uid not in [p["uid"] for p in room["players"]]:
        return

    player_info = next((p for p in room["players"] if p["uid"] == uid), {})
    room["status"] = "finished"
    task = _boredom_tasks.pop(room_id, None)
    if task:
        task.cancel()
    await manager.broadcast(room_id, ServerEvent.GAME_ABANDONED, {
        "uid": uid,
        "display_name": player_info.get("display_name", "Jugador"),
    })
    # Close the room 5 seconds later so players can see the abandoned screen
    asyncio.create_task(_close_room_after(room_id, 5.0, "La partida ha sido abandonada"))


# ── Internal helpers ──────────────────────────────────────

async def _ai_chat(room_id: str, message: str, delay: float = 0.0) -> None:
    if delay:
        await asyncio.sleep(delay)
    room = _rooms.get(room_id)
    if not room:
        return
    # Only chat in pure 1v1 (one human vs AI) — stays silent in multiplayer human games
    human_count = sum(1 for p in room["players"] if not p.get("is_ai"))
    if human_count != 1:
        return
    ai_uid = next((p["uid"] for p in room["players"] if p.get("is_ai")), None)
    if not ai_uid:
        return
    await manager.broadcast(room_id, ServerEvent.CHAT_MESSAGE, {
        "uid": ai_uid,
        "display_name": "Arcade IA",
        "message": message,
        "is_spectator": False,
    })


async def _boredom_check(room_id: str, expected_uid: str) -> None:
    """Fire a bored message if the human hasn't moved after 25 seconds."""
    await asyncio.sleep(25)
    _boredom_tasks.pop(room_id, None)
    room = _rooms.get(room_id)
    if not room or room.get("status") != "playing":
        return
    if room.get("game_state", {}).get("current_turn") == expected_uid:
        await _ai_chat(room_id, random.choice(_AI_POOL_BORED))


async def _handle_set_player_color(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    color = data.get("color", "")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if uid not in [p["uid"] for p in room["players"]]:
        return
    if color not in _DEFAULT_COLORS:
        return
    player_colors = room.setdefault("player_colors", {})
    taken_by = {v: k for k, v in player_colors.items()}

    if color in taken_by and taken_by[color] != uid:
        owner_uid = taken_by[color]
        owner = next((p for p in room["players"] if p["uid"] == owner_uid), None)
        if owner and owner.get("is_ai"):
            # Auto-swap: give AI the requester's current color
            old_color = player_colors.get(uid)
            if old_color:
                player_colors[owner_uid] = old_color
            else:
                player_colors.pop(owner_uid, None)
            player_colors[uid] = color
            await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))
        else:
            await manager.send(ws, ServerEvent.ERROR, {"message": "Color ya en uso por otro jugador"})
        return

    player_colors[uid] = color
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_request_color_swap(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    target_uid = data.get("target_uid")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    players = room.get("players", [])
    if uid not in [p["uid"] for p in players]:
        return
    target = next((p for p in players if p["uid"] == target_uid), None)
    if not target or target.get("is_ai"):
        return
    requester = next((p for p in players if p["uid"] == uid), None)
    requester_name = requester.get("display_name", "Jugador") if requester else "Jugador"
    player_colors = room.get("player_colors", {})
    room.setdefault("pending_color_swaps", {})[uid] = target_uid
    await manager.send_to(room_id, target_uid, ServerEvent.COLOR_SWAP_REQUEST, {
        "requester_uid": uid,
        "requester_name": requester_name,
        "requester_color": player_colors.get(uid, ""),
        "target_color": player_colors.get(target_uid, ""),
        "room_id": room_id,
    })


async def _handle_respond_color_swap(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    requester_uid = data.get("requester_uid")
    accept = data.get("accept", False)
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    pending = room.get("pending_color_swaps", {})
    if pending.get(requester_uid) != uid:
        return
    del pending[requester_uid]
    if not accept:
        responder = next((p for p in room["players"] if p["uid"] == uid), None)
        responder_name = responder.get("display_name", "Jugador") if responder else "Jugador"
        await manager.send_to(room_id, requester_uid, ServerEvent.COLOR_SWAP_DECLINED, {
            "target_name": responder_name,
        })
        return
    player_colors = room.setdefault("player_colors", {})
    requester_color = player_colors.get(requester_uid)
    target_color = player_colors.get(uid)
    if target_color:
        player_colors[requester_uid] = target_color
    else:
        player_colors.pop(requester_uid, None)
    if requester_color:
        player_colors[uid] = requester_color
    else:
        player_colors.pop(uid, None)
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_set_game_mode(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    mode = data.get("mode", "ffa")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if room.get("leader_uid") != uid:
        return
    if mode not in ("ffa", "teams"):
        return
    room["game_mode"] = mode
    if mode == "teams":
        uids = [p["uid"] for p in room["players"]]
        mid = max(1, len(uids) // 2)
        room["teams"] = {"a": uids[:mid], "b": uids[mid:]}
    else:
        room["teams"] = {"a": [], "b": []}
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_assign_team(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    target_uid = data.get("uid")
    team = data.get("team")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if room.get("leader_uid") != uid:
        return
    if team not in ("a", "b"):
        return
    teams = room.setdefault("teams", {"a": [], "b": []})
    teams["a"] = [u for u in teams.get("a", []) if u != target_uid]
    teams["b"] = [u for u in teams.get("b", []) if u != target_uid]
    teams[team].append(target_uid)
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_start_game(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if room.get("leader_uid") != uid:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Solo el líder puede iniciar la partida"})
        return
    min_p = room.get("min_players", 2)
    if len(room["players"]) < min_p:
        await manager.send(ws, ServerEvent.ERROR, {"message": f"Se necesitan al menos {min_p} jugadores"})
        return
    await _start_game(room_id)


async def _handle_kick_player(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    target_uid = data.get("uid")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if room.get("leader_uid") != uid:
        await manager.send(ws, ServerEvent.ERROR, {"message": "Solo el líder puede expulsar jugadores"})
        return
    if target_uid == uid:
        return
    target = next((p for p in room["players"] if p["uid"] == target_uid), None)
    if not target:
        return

    is_ai = target.get("is_ai", False)
    room["players"] = [p for p in room["players"] if p["uid"] != target_uid]
    room.get("player_colors", {}).pop(target_uid, None)
    teams = room.get("teams", {})
    teams["a"] = [u for u in teams.get("a", []) if u != target_uid]
    teams["b"] = [u for u in teams.get("b", []) if u != target_uid]

    if not is_ai:
        await manager.send_direct(target_uid, ServerEvent.KICKED, {"message": "Has sido expulsado de la sala"})
        manager.remove(room_id, target_uid)

    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _handle_set_max_players(ws: WebSocket, uid: str, data: dict):
    room_id = data.get("room_id")
    max_players = data.get("max_players")
    room = _rooms.get(room_id)
    if not room or room["status"] != "waiting":
        return
    if room.get("leader_uid") != uid:
        return
    if max_players not in (2, 3, 4):
        await manager.send(ws, ServerEvent.ERROR, {"message": "Número de jugadores inválido"})
        return
    current_count = len(room["players"])
    if max_players < current_count:
        human_players = [p for p in room["players"] if not p.get("is_ai")]
        if len(human_players) > max_players:
            await manager.send(ws, ServerEvent.ERROR, {"message": f"Ya hay {len(human_players)} jugadores humanos en la sala"})
            return
        # Auto-kick AI players to fit the new limit
        excess = current_count - max_players
        ai_players = [p for p in room["players"] if p.get("is_ai")]
        for ai in ai_players[:excess]:
            room["players"] = [p for p in room["players"] if p["uid"] != ai["uid"]]
    room["max_players"] = max_players
    await manager.broadcast(room_id, ServerEvent.ROOM_STATE, _safe_room(room))


async def _start_game(room_id: str):
    room = _rooms[room_id]
    game = get_game(room["game_id"])
    player_uids = [p["uid"] for p in room["players"]]

    # In teams mode, interleave players so turns alternate between teams: A1→B1→A2→B2→…
    if room.get("game_mode") == "teams":
        teams = room.get("teams", {"a": [], "b": []})
        team_a = [u for u in player_uids if u in teams.get("a", [])]
        team_b = [u for u in player_uids if u in teams.get("b", [])]
        interleaved: list[str] = []
        for i in range(max(len(team_a), len(team_b))):
            if i < len(team_a):
                interleaved.append(team_a[i])
            if i < len(team_b):
                interleaved.append(team_b[i])
        # Add players not assigned to any team (e.g. AIs without team assignment)
        assigned = set(team_a + team_b)
        interleaved.extend(u for u in player_uids if u not in assigned)
        player_uids = interleaved

    state = game.get_initial_state(player_uids)
    state["game_mode"] = room.get("game_mode", "ffa")
    state["teams"] = room.get("teams", {"a": [], "b": []})
    room["game_state"] = state
    room["status"] = "playing"
    room["last_activity"] = time.time()
    await manager.broadcast(room_id, ServerEvent.GAME_STARTED, {
        "game_state": _public_state(room["game_state"]),
        "players": room["players"],
    })

    turn_uid = room["game_state"].get("current_turn")
    if turn_uid and _is_ai_uid(room, turn_uid):
        asyncio.create_task(_do_ai_move(room_id))

    if any(p.get("is_ai") for p in room["players"]):
        asyncio.create_task(_ai_chat(room_id, random.choice(_AI_POOL_START), delay=1.5))


async def _do_ai_move(room_id: str):
    room = _rooms.get(room_id)
    if not room or room["status"] != "playing":
        return

    ai_uid = room["game_state"].get("current_turn")
    if not ai_uid or not _is_ai_uid(room, ai_uid):
        return

    game = get_game(room["game_id"])
    await manager.broadcast(room_id, ServerEvent.AI_THINKING, {})
    await asyncio.sleep(0.8)

    move = None
    new_state = None
    try:
        move = await get_ai_move(game, room["game_state"], ai_uid)
        new_state = game.apply_move(room["game_state"], ai_uid, move)
    except Exception:
        # Fallback: pick a random valid move so the turn always advances
        try:
            valid = game.get_valid_moves(room["game_state"], ai_uid)
            if not valid:
                return
            move = random.choice(valid)
            new_state = game.apply_move(room["game_state"], ai_uid, move)
        except Exception:
            return

    if new_state is None:
        return

    room["game_state"] = new_state
    room["last_activity"] = time.time()
    await manager.broadcast(room_id, ServerEvent.MOVE_MADE, {
        "move": move,
        "uid": ai_uid,
        "game_state": _public_state(new_state),
    })

    if game.is_terminal(new_state):
        await _end_game(room_id, room, game, new_state)
        return

    next_uid = new_state.get("current_turn")
    if next_uid and _is_ai_uid(room, next_uid):
        asyncio.create_task(_do_ai_move(room_id))
    elif next_uid:
        room["human_turn_start"] = time.time()
        old = _boredom_tasks.pop(room_id, None)
        if old:
            old.cancel()
        _boredom_tasks[room_id] = asyncio.create_task(_boredom_check(room_id, next_uid))


async def _end_game(room_id: str, room: dict, game, state: dict):
    room["status"] = "finished"
    room["last_activity"] = time.time()
    scores = game.get_scores(state)
    winner = game.get_winner(state)

    await manager.broadcast(room_id, ServerEvent.GAME_OVER, {
        "winner": winner,
        "scores": scores,
        "game_state": _public_state(state),
        "rematch_votes": [],
    })

    has_ai = any(p.get("is_ai") for p in room.get("players", []))
    winner_is_ai = bool(winner and _is_ai_uid(room, winner))
    asyncio.create_task(award_points(scores, room["game_id"]))
    if winner and not winner_is_ai:
        asyncio.create_task(mark_win(winner, room["game_id"]))

    if has_ai:
        if winner_is_ai:
            asyncio.create_task(_ai_chat(room_id, random.choice(_AI_POOL_WIN), delay=1.5))
        elif winner is not None:
            asyncio.create_task(_ai_chat(room_id, random.choice(_AI_POOL_LUCK), delay=1.5))


def _safe_room(room: dict) -> dict:
    return {k: v for k, v in room.items() if k not in ("game_state", "rematch_votes")}


def _public_state(state: dict) -> dict:
    """Strip mine positions from Minesweeper state sent to clients."""
    if "board" in state and state.get("board") is not None:
        board = state["board"]
        revealed = state.get("revealed", [])
        public_board = [
            [cell if revealed[r][c] else -2 for c, cell in enumerate(row)]
            for r, row in enumerate(board)
        ] if revealed else board
        return {**state, "board": public_board}
    return state
