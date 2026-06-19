import math
import random
import copy
from typing import Any, Optional
from app.games.base import BaseGame

W, H = 800, 500
PADDLE_W, PADDLE_H = 14, 90
PADDLE_MARGIN = 24
BALL_SIZE = 14
PADDLE_SPEED = 8
INITIAL_SPEED = 10.0
MAX_SPEED = 20.0
SPEED_INCREMENT = 0.5
WALL_SPEED_INCREMENT = 0.3
WIN_SCORE = 15
SERVE_TICKS = 20       # ~0.67s pause after each point (at 30fps)
MAX_BOUNCE_ANGLE = 0.42 * math.pi  # ~75° max deflection


def _new_ball(toward_loser: str | None = None, players: list[str] | None = None) -> dict:
    vy_sign = random.choice([1, -1])
    vy = random.uniform(INITIAL_SPEED * 0.3, INITIAL_SPEED * 0.55) * vy_sign

    if toward_loser and players and toward_loser in players:
        vx = INITIAL_SPEED if players.index(toward_loser) == 0 else -INITIAL_SPEED
    else:
        vx = INITIAL_SPEED * random.choice([1, -1])

    return {
        "x": W / 2 - BALL_SIZE / 2,
        "y": H / 2 - BALL_SIZE / 2,
        "vx": float(vx),
        "vy": float(vy),
        "speed": INITIAL_SPEED,
        "serve": SERVE_TICKS,  # countdown before ball moves
    }


class PongGame(BaseGame):

    def get_initial_state(self, player_uids: list[str], win_score: int = 15) -> dict:
        p0, p1 = player_uids[0], player_uids[1]
        return {
            "width": W,
            "height": H,
            "paddle_w": PADDLE_W,
            "paddle_h": PADDLE_H,
            "ball_size": BALL_SIZE,
            "paddles": {
                p0: {"y": float(H // 2 - PADDLE_H // 2), "moving": None, "side": "left"},
                p1: {"y": float(H // 2 - PADDLE_H // 2), "moving": None, "side": "right"},
            },
            "ball": _new_ball(),
            "scores": {p0: 0, p1: 0},
            "players": player_uids,
            "winner": None,
            "current_turn": None,
            "win_score": win_score,
            "tick": 0,
        }

    # ── Physics tick ──────────────────────────────────────────────

    def tick(self, state: dict) -> dict:
        state = copy.deepcopy(state)
        players: list[str] = state["players"]
        paddles: dict = state["paddles"]
        ball: dict = state["ball"]
        scores: dict = state["scores"]

        # Serving countdown: ball stays frozen
        if ball.get("serve", 0) > 0:
            ball["serve"] -= 1
            state["tick"] = state.get("tick", 0) + 1
            return state

        # Move paddles
        for uid, paddle in paddles.items():
            mv = paddle.get("moving")
            if mv == "up":
                paddle["y"] = max(0.0, paddle["y"] - PADDLE_SPEED)
            elif mv == "down":
                paddle["y"] = min(float(H - PADDLE_H), paddle["y"] + PADDLE_SPEED)

        bx = ball["x"] + ball["vx"]
        by = ball["y"] + ball["vy"]
        vx = ball["vx"]
        vy = ball["vy"]
        speed = ball["speed"]

        # Top / bottom wall bounce — speed up and flatten trajectory each hit
        if by <= 0:
            by = 0.0
            speed = min(speed + WALL_SPEED_INCREMENT, MAX_SPEED)
            vy_mag = abs(vy) * 0.80
            vx = math.copysign(math.sqrt(max(speed ** 2 - vy_mag ** 2, 1.0)), vx)
            vy = vy_mag
            ball["speed"] = speed
        elif by + BALL_SIZE >= H:
            by = float(H - BALL_SIZE)
            speed = min(speed + WALL_SPEED_INCREMENT, MAX_SPEED)
            vy_mag = abs(vy) * 0.80
            vx = math.copysign(math.sqrt(max(speed ** 2 - vy_mag ** 2, 1.0)), vx)
            vy = -vy_mag
            ball["speed"] = speed

        p0, p1 = players[0], players[1]
        lp = paddles[p0]  # left
        rp = paddles[p1]  # right

        # Left paddle collision
        lx = float(PADDLE_MARGIN)
        lpx2 = lx + PADDLE_W
        if (vx < 0
                and bx <= lpx2
                and ball["x"] + BALL_SIZE >= lx
                and by + BALL_SIZE > lp["y"]
                and by < lp["y"] + PADDLE_H):
            bx = lpx2
            hit = (by + BALL_SIZE / 2 - lp["y"]) / PADDLE_H
            angle = (hit - 0.5) * 2 * MAX_BOUNCE_ANGLE
            speed = min(speed + SPEED_INCREMENT, MAX_SPEED)
            vx = abs(math.cos(angle)) * speed
            vy = math.sin(angle) * speed
            ball["speed"] = speed

        # Right paddle collision
        rx = float(W - PADDLE_MARGIN - PADDLE_W)
        if (vx > 0
                and bx + BALL_SIZE >= rx
                and ball["x"] <= rx + PADDLE_W
                and by + BALL_SIZE > rp["y"]
                and by < rp["y"] + PADDLE_H):
            bx = rx - BALL_SIZE
            hit = (by + BALL_SIZE / 2 - rp["y"]) / PADDLE_H
            angle = (hit - 0.5) * 2 * MAX_BOUNCE_ANGLE
            speed = min(speed + SPEED_INCREMENT, MAX_SPEED)
            vx = -abs(math.cos(angle)) * speed
            vy = math.sin(angle) * speed
            ball["speed"] = speed

        # Scoring
        scored_uid: str | None = None
        if bx <= 0:
            scores[p1] = scores.get(p1, 0) + 1
            scored_uid = p1
        elif bx + BALL_SIZE >= W:
            scores[p0] = scores.get(p0, 0) + 1
            scored_uid = p0

        if scored_uid:
            if max(scores.values()) >= state.get("win_score", WIN_SCORE):
                state["winner"] = max(scores, key=lambda u: scores[u])
            # Reset ball toward the player who just scored (they earned the attack)
            state["ball"] = _new_ball(scored_uid, players)
        else:
            ball["x"] = float(bx)
            ball["y"] = float(by)
            ball["vx"] = float(vx)
            ball["vy"] = float(vy)

        state["scores"] = scores
        state["tick"] = state.get("tick", 0) + 1
        return state

    # ── AI ────────────────────────────────────────────────────────

    def get_ai_direction(self, state: dict, ai_uid: str) -> str | None:
        paddle = state.get("paddles", {}).get(ai_uid)
        ball = state.get("ball", {})
        if not paddle or ball.get("serve", 0) > 0:
            return None
        pc = paddle["y"] + PADDLE_H / 2
        bc = ball.get("y", H / 2) + BALL_SIZE / 2
        if pc < bc - 4:
            return "down"
        if pc > bc + 4:
            return "up"
        return None

    # ── BaseGame interface ─────────────────────────────────────────

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        return state  # pong uses direct paddle state mutation + tick

    def is_terminal(self, state: dict) -> bool:
        return state.get("winner") is not None

    def get_winner(self, state: dict) -> Optional[str]:
        return state.get("winner")

    def get_scores(self, state: dict) -> dict[str, int]:
        winner = state.get("winner")
        result = {}
        for uid in state.get("players", []):
            raw = state.get("scores", {}).get(uid, 0)
            result[uid] = (100 + raw * 3) if uid == winner else max(10, raw * 3)
        return result

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        return ["up", "down"]

    def get_best_move(self, state: dict) -> Any:
        return None
