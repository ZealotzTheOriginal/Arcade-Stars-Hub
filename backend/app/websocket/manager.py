import json
import asyncio
from fastapi import WebSocket
from app.websocket.events import WSMessage


class ConnectionManager:
    def __init__(self):
        # room_id -> {uid: websocket}
        self._rooms: dict[str, dict[str, WebSocket]] = {}

    def add(self, room_id: str, uid: str, ws: WebSocket):
        self._rooms.setdefault(room_id, {})[uid] = ws

    def remove(self, room_id: str, uid: str):
        room = self._rooms.get(room_id, {})
        room.pop(uid, None)
        if not room:
            self._rooms.pop(room_id, None)

    def players_in_room(self, room_id: str) -> list[str]:
        return list(self._rooms.get(room_id, {}).keys())

    async def send(self, ws: WebSocket, event: str, data=None):
        msg = WSMessage(event=event, data=data)
        await ws.send_text(msg.model_dump_json())

    async def broadcast(self, room_id: str, event: str, data=None, exclude_uid: str | None = None):
        msg = WSMessage(event=event, data=data).model_dump_json()
        dead: list[tuple[str, str]] = []
        for uid, ws in list(self._rooms.get(room_id, {}).items()):
            if uid == exclude_uid:
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append((room_id, uid))
        for r, u in dead:
            self.remove(r, u)

    async def send_to(self, room_id: str, uid: str, event: str, data=None):
        ws = self._rooms.get(room_id, {}).get(uid)
        if ws:
            await self.send(ws, event, data)


manager = ConnectionManager()
