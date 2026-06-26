import random
import copy
from collections import deque
from typing import Any, Optional
from app.games.base import BaseGame

BOARD = 24
DIRS: dict[str, tuple[int, int]] = {
    "up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)
}
OPP = {"up": "down", "down": "up", "left": "right", "right": "left"}
INIT_LEN = 3
FOOD_TARGET = 3
RAINBOW_CHANCE = 0.15


def _free_cells(state: dict) -> list[tuple[int, int]]:
    occ: set[tuple] = set()
    for s in state["snakes"].values():
        for cell in s["body"]:
            occ.add(tuple(cell))
    for f in state["food"]:
        occ.add((f["r"], f["c"]))
    return [(r, c) for r in range(BOARD) for c in range(BOARD) if (r, c) not in occ]


def _spawn_food(state: dict) -> dict | None:
    free = _free_cells(state)
    if not free:
        return None
    r, c = random.choice(free)
    return {"r": r, "c": c, "type": "rainbow" if random.random() < RAINBOW_CHANCE else "normal"}


class SnakeGame(BaseGame):

    def get_initial_state(self, player_uids: list[str]) -> dict:
        mid = BOARD // 2
        configs = [
            (mid, 3, "right"),
            (mid, BOARD - 4, "left"),
        ]
        snakes: dict = {}
        for i, uid in enumerate(player_uids):
            r, c, d = configs[i % len(configs)]
            if d == "right":
                body = [[r, c - j] for j in range(INIT_LEN)]
            elif d == "left":
                body = [[r, c + j] for j in range(INIT_LEN)]
            elif d == "down":
                body = [[r - j, c] for j in range(INIT_LEN)]
            else:
                body = [[r + j, c] for j in range(INIT_LEN)]
            snakes[uid] = {
                "body": body,
                "direction": d,
                "pending_dirs": [],  # queue, max 3 — one dequeued per tick
                "alive": True,
                "score": 0,
            }

        state: dict = {
            "board_size": BOARD,
            "snakes": snakes,
            "food": [],
            "scores": {uid: 0 for uid in player_uids},
            "players": player_uids,
            "winner": None,
            "tick": 0,
            "current_turn": None,
        }
        for _ in range(FOOD_TARGET):
            f = _spawn_food(state)
            if f:
                state["food"].append(f)
        return state

    # ── Tick ──────────────────────────────────────────────────────

    def tick(self, state: dict) -> dict:
        state = copy.deepcopy(state)
        snakes = state["snakes"]

        # Dequeue one direction per tick (no 180° reversal)
        for snake in snakes.values():
            if not snake["alive"]:
                continue
            pending = snake.get("pending_dirs", [])
            if pending:
                pd = pending.pop(0)
                if pd != OPP.get(snake["direction"]):
                    snake["direction"] = pd

        # Compute new head positions
        new_heads: dict[str, list[int]] = {}
        dying: set[str] = set()

        for uid, snake in snakes.items():
            if not snake["alive"]:
                continue
            hr, hc = snake["body"][0]
            dr, dc = DIRS[snake["direction"]]
            nr, nc = hr + dr, hc + dc
            if not (0 <= nr < BOARD and 0 <= nc < BOARD):
                dying.add(uid)
            else:
                new_heads[uid] = [nr, nc]

        # Occupied cells (body minus tail since it will move away)
        occupied: dict[str, set[tuple]] = {}
        for uid, snake in snakes.items():
            if snake["alive"]:
                occupied[uid] = set(map(tuple, snake["body"][:-1]))

        # Body collisions (self + other snakes)
        for uid, head in list(new_heads.items()):
            if uid in dying:
                continue
            hpos = tuple(head)
            if hpos in occupied.get(uid, set()):
                dying.add(uid)
                continue
            for ouid, occ_set in occupied.items():
                if ouid != uid and hpos in occ_set:
                    dying.add(uid)
                    break

        # Head-on collisions
        by_pos: dict[tuple, list[str]] = {}
        for uid, head in new_heads.items():
            if uid not in dying:
                by_pos.setdefault(tuple(head), []).append(uid)
        for uids in by_pos.values():
            if len(uids) > 1:
                dying.update(uids)

        for uid in dying:
            snakes[uid]["alive"] = False

        # Move bodies
        food_map = {(f["r"], f["c"]): f for f in state["food"]}
        eaten: set[tuple] = set()

        for uid, snake in snakes.items():
            if not snake["alive"] or uid not in new_heads:
                continue
            head = new_heads[uid]
            hpos = tuple(head)
            ate_food = hpos in food_map
            snake["body"] = [head] + snake["body"]
            if not ate_food:
                snake["body"] = snake["body"][:-1]
            else:
                pts = 3 if food_map[hpos]["type"] == "rainbow" else 1
                snake["score"] += pts
                state["scores"][uid] = state["scores"].get(uid, 0) + pts
                eaten.add(hpos)

        # Refresh food
        state["food"] = [f for f in state["food"] if (f["r"], f["c"]) not in eaten]
        for _ in range(len(eaten)):
            nf = _spawn_food(state)
            if nf:
                state["food"].append(nf)

        state["tick"] = state.get("tick", 0) + 1
        if self.is_terminal(state):
            state["winner"] = self.get_winner(state)
        return state

    # ── BaseGame interface ─────────────────────────────────────────

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        """Push direction onto pending queue for uid."""
        direction = str(move)
        if direction not in DIRS:
            raise ValueError(f"Invalid direction: {direction}")
        snake = state.get("snakes", {}).get(uid)
        if not snake or not snake.get("alive"):
            return state
        pending = list(snake.get("pending_dirs", []))
        if len(pending) >= 3:
            return state
        effective = pending[-1] if pending else snake.get("direction", "right")
        if direction == OPP.get(effective, ""):
            return state
        pending.append(direction)
        return {**state, "snakes": {**state["snakes"], uid: {**snake, "pending_dirs": pending}}}

    def is_terminal(self, state: dict) -> bool:
        alive = [s for s in state.get("snakes", {}).values() if s.get("alive")]
        return len(alive) <= 1

    def get_winner(self, state: dict) -> Optional[str]:
        snakes = state.get("snakes", {})
        if not snakes:
            return None
        scores = {uid: s.get("score", 0) for uid, s in snakes.items()}
        max_sc = max(scores.values())
        tops = [uid for uid, sc in scores.items() if sc == max_sc]
        if len(tops) == 1:
            return tops[0]
        alive = [uid for uid, s in snakes.items() if s.get("alive")]
        if len(alive) == 1 and alive[0] in tops:
            return alive[0]
        return None

    def get_scores(self, state: dict) -> dict[str, int]:
        winner = self.get_winner(state)
        result = {}
        for uid, snake in state.get("snakes", {}).items():
            raw = snake.get("score", 0)
            if winner is None:
                result[uid] = 25 + raw * 5
            elif uid == winner:
                result[uid] = 100 + raw * 5
            else:
                result[uid] = max(10, raw * 5)
        return result

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        snake = state.get("snakes", {}).get(uid)
        if not snake or not snake.get("alive"):
            return []
        return [d for d in DIRS if d != OPP.get(snake.get("direction", ""))]

    def get_best_move(self, state: dict) -> Any:
        return None  # snake uses tick-based AI via get_ai_direction()

    # ── AI ─────────────────────────────────────────────────────────

    def get_ai_direction(self, state: dict, ai_uid: str) -> str:
        """BFS to nearest food, fallback flood-fill for safest open space."""
        snake = state.get("snakes", {}).get(ai_uid)
        if not snake or not snake.get("alive"):
            return "right"
        head = tuple(snake["body"][0])
        cur_dir = snake.get("direction", "right")

        # Occupied cells (body minus tails)
        occ: set[tuple] = set()
        for s in state["snakes"].values():
            for cell in s["body"][:-1]:
                occ.add(tuple(cell))

        # BFS to nearest food
        food_set = {(f["r"], f["c"]) for f in state["food"]}
        if food_set:
            q: deque = deque([(head, None)])
            visited: set[tuple] = {head}
            while q:
                pos, first_dir = q.popleft()
                if pos in food_set and first_dir:
                    return first_dir
                for d, (dr, dc) in DIRS.items():
                    if first_dir is None and d == OPP.get(cur_dir):
                        continue
                    nr, nc = pos[0] + dr, pos[1] + dc
                    npos = (nr, nc)
                    if (0 <= nr < BOARD and 0 <= nc < BOARD
                            and npos not in visited and npos not in occ):
                        visited.add(npos)
                        q.append((npos, d if first_dir is None else first_dir))

        # Fallback: choose direction with most reachable open space
        best, best_n = cur_dir, -1
        for d, (dr, dc) in DIRS.items():
            if d == OPP.get(cur_dir):
                continue
            nr, nc = head[0] + dr, head[1] + dc
            if not (0 <= nr < BOARD and 0 <= nc < BOARD) or (nr, nc) in occ:
                continue
            n = self._flood(nr, nc, occ)
            if n > best_n:
                best_n, best = n, d
        return best

    def _flood(self, r: int, c: int, occ: set) -> int:
        q: deque = deque([(r, c)])
        vis = {(r, c)}
        count = 0
        while q and count < 64:
            cr, cc = q.popleft()
            count += 1
            for dr, dc in DIRS.values():
                npos = (cr + dr, cc + dc)
                if (0 <= npos[0] < BOARD and 0 <= npos[1] < BOARD
                        and npos not in vis and npos not in occ):
                    vis.add(npos)
                    q.append(npos)
        return count
