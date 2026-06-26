import math
import random
from typing import Any, Optional
from app.games.base import BaseGame

# ── Constants (all speeds in px/s) ────────────────────────────────────────────
W, H = 800, 500
PADDLE_W, PADDLE_H = 14, 90
PADDLE_MARGIN = 24
BALL_SIZE = 20
PADDLE_SPEED  = 240.0   # px/s
INITIAL_SPEED = 300.0   # px/s
MAX_SPEED     = 600.0   # px/s
SPEED_INCREMENT      = 15.0  # px/s added per paddle hit
WALL_SPEED_INCREMENT =  9.0  # px/s added per wall bounce
WIN_SCORE  = 15
SERVE_MS   = 667        # ms ball stays frozen after each point
MAX_BOUNCE_ANGLE = 0.42 * math.pi  # ~75° max deflection


# ── Serve trajectory ───────────────────────────────────────────────────────────

def get_serve_trajectory(toward_uid: str | None = None,
                         players: list[str] | None = None) -> dict:
    """Initial ball trajectory for a serve. Ball starts at centre, frozen for SERVE_MS."""
    vy_sign = random.choice([1, -1])
    vy = random.uniform(INITIAL_SPEED * 0.30, INITIAL_SPEED * 0.55) * vy_sign

    if toward_uid and players and toward_uid in players:
        vx = INITIAL_SPEED if players.index(toward_uid) == 0 else -INITIAL_SPEED
    else:
        vx = INITIAL_SPEED * random.choice([1, -1])

    speed = math.sqrt(vx ** 2 + vy ** 2)
    return {
        "x":        float(W / 2 - BALL_SIZE / 2),
        "y":        float(H / 2 - BALL_SIZE / 2),
        "vx":       float(vx),
        "vy":       float(vy),
        "speed":    float(speed),
        "serving":  True,
        "serve_ms": SERVE_MS,
    }


# ── Paddle-hit trajectory ──────────────────────────────────────────────────────

def calculate_hit(hit_pos: float, paddle_dir: str | None,
                  incoming_speed: float, side: str, ball_y: float) -> dict:
    """
    Compute new ball trajectory after a paddle hit.

    hit_pos     : 0.0 = top of paddle, 1.0 = bottom
    paddle_dir  : "up" | "down" | None
    incoming_speed: ball speed (px/s) at moment of impact
    side        : "left" | "right"
    ball_y      : ball y at impact
    """
    speed = min(incoming_speed + SPEED_INCREMENT, MAX_SPEED)

    hit_pos = max(0.0, min(1.0, float(hit_pos)))
    angle   = (hit_pos - 0.5) * 2.0 * MAX_BOUNCE_ANGLE  # negative = upward

    base_vy = math.sin(angle) * speed

    # Paddle-direction effect adds extra vertical momentum
    PADDLE_EFFECT = 30.0  # px/s
    if paddle_dir == "up":
        base_vy -= PADDLE_EFFECT
    elif paddle_dir == "down":
        base_vy += PADDLE_EFFECT

    # Clamp vy and recalculate vx to maintain speed
    max_vy  = speed * math.sin(MAX_BOUNCE_ANGLE)
    base_vy = max(-max_vy, min(max_vy, base_vy))
    vx_mag  = math.sqrt(max(speed ** 2 - base_vy ** 2, 1.0))

    if side == "left":
        vx    = vx_mag
        ball_x = float(PADDLE_MARGIN + PADDLE_W)
    else:
        vx    = -vx_mag
        ball_x = float(W - PADDLE_MARGIN - PADDLE_W - BALL_SIZE)

    return {
        "x":       ball_x,
        "y":       float(ball_y),
        "vx":      float(vx),
        "vy":      float(base_vy),
        "speed":   float(speed),
        "serving": False,
    }


# ── Ball-arrival prediction (for AI) ──────────────────────────────────────────

def calculate_ball_arrival(traj: dict, side: str) -> tuple[float, float, float]:
    """
    Return (t_arrival_s, ball_y_at_arrival, speed_at_arrival) for a trajectory
    heading toward `side`. Returns (999.0, 0, 0) if not heading toward that side.

    Simulates wall bounces step by step, tracking x and vx changes so the timing
    matches the client's extrapolateBall physics exactly.
    """
    x, y   = float(traj["x"]), float(traj["y"])
    vx, vy = float(traj["vx"]), float(traj["vy"])
    speed  = float(traj.get("speed", INITIAL_SPEED))

    if side == "left":
        target_x = float(PADDLE_MARGIN + PADDLE_W)
        if vx >= 0:
            return (999.0, y, speed)
    else:
        target_x = float(W - PADDLE_MARGIN - PADDLE_W - BALL_SIZE)
        if vx <= 0:
            return (999.0, y, speed)

    t_total = 0.0

    for _ in range(30):
        t_to_target = (target_x - x) / vx

        if vy < 0:
            t_wall = -y / vy if vy != 0 else 999.0
        elif vy > 0:
            t_wall = (H - BALL_SIZE - y) / vy if vy != 0 else 999.0
        else:
            t_wall = 999.0

        t_wall = max(t_wall, 0.001)

        if t_to_target <= t_wall:
            # Ball reaches target before next wall bounce
            t_total += t_to_target
            y += vy * t_to_target
            break

        # Wall bounce — update x and vx (same physics as client's extrapolateBall)
        t_total += t_wall
        x += vx * t_wall
        y += vy * t_wall
        y = max(0.0, min(float(H - BALL_SIZE), y))
        speed = min(speed + WALL_SPEED_INCREMENT, MAX_SPEED)
        vy_mag = abs(vy) * 0.80
        vx = math.copysign(math.sqrt(max(speed ** 2 - vy_mag ** 2, 1.0)), vx)
        vy = vy_mag if vy < 0 else -vy_mag

    return (float(t_total), float(y), float(speed))


# ── Game class ─────────────────────────────────────────────────────────────────

class PongGame(BaseGame):

    def get_initial_state(self, player_uids: list[str], win_score: int = 15) -> dict:
        p0, p1 = player_uids[0], player_uids[1]
        return {
            "width":    W,
            "height":   H,
            "paddle_w": PADDLE_W,
            "paddle_h": PADDLE_H,
            "ball_size": BALL_SIZE,
            "paddles": {
                p0: {"y": float(H // 2 - PADDLE_H // 2), "side": "left"},
                p1: {"y": float(H // 2 - PADDLE_H // 2), "side": "right"},
            },
            "ball":     {"x": float(W / 2), "y": float(H / 2), "vx": 0.0, "vy": 0.0, "speed": 0.0},
            "scores":   {p0: 0, p1: 0},
            "players":  player_uids,
            "winner":   None,
            "win_score": win_score,
        }

    # BaseGame interface ──────────────────────────────────────────────────────

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        return state

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
