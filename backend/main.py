import json
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.firebase_client import verify_token
from app.websocket.manager import manager
from app.websocket.handler import handle_message, unregister_presence, cleanup_stale_rooms
from app.api.routes import users, games, leaderboard

# ── Game registry bootstrap ───────────────────────────────
from app.games.registry import register
from app.models.game_room import GameDefinition
from app.games.connect_four.game import ConnectFourGame
from app.games.tic_tac_toe.game import TicTacToeGame
from app.games.minesweeper.game import MinesweeperGame


async def _room_cleanup_loop():
    while True:
        await asyncio.sleep(60)
        try:
            await cleanup_stale_rooms()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    register(
        GameDefinition(
            id="connect_four",
            name="Conecta Cuatro",
            description="Sé el primero en alinear cuatro fichas en horizontal, vertical o diagonal.",
            category="Estrategia",
            thumbnail="🔴",
            max_players=2,
            has_ai=True,
        ),
        ConnectFourGame(),
    )
    register(
        GameDefinition(
            id="tic_tac_toe",
            name="Tres en Raya",
            description="Clásico juego de X y O. Alinea tres símbolos para ganar.",
            category="Estrategia",
            thumbnail="✖️",
            max_players=2,
            has_ai=True,
        ),
        TicTacToeGame(),
    )
    register(
        GameDefinition(
            id="minesweeper",
            name="Buscaminas",
            description="Descubre casillas sin explotar minas. Turnos alternos entre jugadores.",
            category="Puzzle",
            thumbnail="💣",
            max_players=2,
            has_ai=True,
        ),
        MinesweeperGame(),
    )

    cleanup_task = asyncio.create_task(_room_cleanup_loop())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Arcade Stars Hub API", version="1.0.0", lifespan=lifespan)

_extra_origins = [settings.frontend_url] if settings.frontend_url != "http://localhost:4200" else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", *_extra_origins],
    allow_origin_regex=r"(http://localhost:\d+|https://[\w-]+\.onrender\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api")
app.include_router(games.router, prefix="/api")
app.include_router(leaderboard.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/debug/firebase")
async def debug_firebase():
    import os
    has_json = bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"))
    has_file = False
    try:
        from pathlib import Path
        has_file = Path(settings.firebase_service_account_path).exists()
    except Exception:
        pass
    try:
        from app.core.firebase_client import get_firebase_app
        get_firebase_app()
        return {"firebase": "ok", "source": "json_env" if has_json else "file", "has_json_env": has_json, "has_file": has_file}
    except Exception as e:
        return {"firebase": "error", "detail": str(e), "has_json_env": has_json, "has_file": has_file}


# ── WebSocket endpoint ────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(...)):
    try:
        user = await verify_token(token)
        uid = user["uid"]
    except Exception:
        await ws.close(code=4001)
        return

    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            await handle_message(ws, uid, raw)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await handle_message(ws, uid, json.dumps({"event": "leave_room", "data": {}}))
        manager.unregister_direct(uid)
        unregister_presence(uid)
