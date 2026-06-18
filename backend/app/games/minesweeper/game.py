import random
from typing import Any, Optional
from app.games.base import BaseGame

POINTS_PER_CELL = 5
POINTS_WIN_BONUS = 50

BOARD_SIZES = {
    "normal":       (9,  9,  10),
    "intermediate": (16, 16, 40),
    "expert":       (30, 16, 99),
}


class MinesweeperGame(BaseGame):

    def get_initial_state(self, player_uids: list[str], board_size: str = "normal") -> dict:
        cols, rows, mines = BOARD_SIZES.get(board_size, BOARD_SIZES["normal"])
        return {
            "board": None,
            "revealed": [[False] * cols for _ in range(rows)],
            "flagged":  [[False] * cols for _ in range(rows)],
            "players": player_uids,
            "current_turn": player_uids[0],
            "scores": {uid: 0 for uid in player_uids},
            "winner": None,
            "game_over": False,
            "rows": rows,
            "cols": cols,
            "mines": mines,
            "board_size": board_size,
        }

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        if state["current_turn"] != uid:
            raise ValueError("Not your turn")
        if state["game_over"]:
            raise ValueError("Game is already over")

        rows  = state["rows"]
        cols  = state["cols"]
        mines = state["mines"]

        row, col = int(move["row"]), int(move["col"])
        action   = move.get("action", "reveal")

        state    = {**state}
        revealed = [r[:] for r in state["revealed"]]
        flagged  = [r[:] for r in state["flagged"]]
        scores   = dict(state["scores"])

        if action == "flag":
            flagged[row][col] = not flagged[row][col]
            return {**state, "revealed": revealed, "flagged": flagged}

        board = state["board"]
        if board is None:
            board = self._generate_board(row, col, rows, cols, mines)

        if revealed[row][col]:
            raise ValueError("Cell already revealed")

        players = state["players"]
        idx      = players.index(uid)
        next_turn = players[(idx + 1) % len(players)]

        if board[row][col] == -1:
            revealed[row][col] = True
            other_scores = {u: scores[u] for u in scores if u != uid}
            if other_scores:
                winner = max(other_scores, key=lambda u: other_scores[u])
            else:
                winner = uid
            scores[winner] = scores.get(winner, 0) + POINTS_WIN_BONUS
            return {
                **state,
                "board": board,
                "revealed": revealed,
                "flagged": flagged,
                "scores": scores,
                "current_turn": uid,
                "winner": winner,
                "game_over": True,
            }

        newly_revealed = self._flood_reveal(board, revealed, row, col, rows, cols)
        scores[uid] = scores.get(uid, 0) + newly_revealed * POINTS_PER_CELL

        total_safe = rows * cols - mines
        total_revealed = sum(
            revealed[r][c] and board[r][c] != -1
            for r in range(rows) for c in range(cols)
        )

        winner    = None
        game_over = False
        if total_revealed >= total_safe:
            winner = max(scores, key=lambda u: scores[u])
            scores[winner] = scores.get(winner, 0) + POINTS_WIN_BONUS
            game_over = True

        return {
            **state,
            "board": board,
            "revealed": revealed,
            "flagged": flagged,
            "scores": scores,
            "current_turn": next_turn if not game_over else uid,
            "winner": winner,
            "game_over": game_over,
        }

    def is_terminal(self, state: dict) -> bool:
        return state.get("game_over", False)

    def get_winner(self, state: dict) -> Optional[str]:
        return state.get("winner")

    def get_scores(self, state: dict) -> dict[str, int]:
        return state.get("scores", {})

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        if self.is_terminal(state) or state["current_turn"] != uid:
            return []
        rows, cols = state["rows"], state["cols"]
        revealed   = state["revealed"]
        return [
            {"row": r, "col": c, "action": "reveal"}
            for r in range(rows) for c in range(cols)
            if not revealed[r][c]
        ]

    def get_best_move(self, state: dict) -> Any:
        board    = state.get("board")
        rows, cols = state["rows"], state["cols"]
        revealed = state["revealed"]
        flagged  = state.get("flagged", [[False] * cols for _ in range(rows)])

        if board is None:
            return {"row": rows // 2, "col": cols // 2, "action": "reveal"}

        known_safe: set = set()
        known_mines: set = set()

        for r in range(rows):
            for c in range(cols):
                if not revealed[r][c] or board[r][c] <= 0:
                    continue
                number    = board[r][c]
                neighbors = [
                    (r + dr, c + dc)
                    for dr in range(-1, 2) for dc in range(-1, 2)
                    if (dr, dc) != (0, 0) and 0 <= r + dr < rows and 0 <= c + dc < cols
                ]
                flagged_n = sum(1 for nr, nc in neighbors if flagged[nr][nc])
                unknown   = [(nr, nc) for nr, nc in neighbors
                             if not revealed[nr][nc] and not flagged[nr][nc]]
                remaining = number - flagged_n
                if remaining == 0:
                    known_safe.update(unknown)
                elif remaining == len(unknown) and unknown:
                    known_mines.update(unknown)

        safe_choices = list(known_safe - known_mines)
        if safe_choices:
            row, col = safe_choices[0]
            return {"row": row, "col": col, "action": "reveal"}

        candidates = [
            (r, c) for r in range(rows) for c in range(cols)
            if not revealed[r][c] and not flagged[r][c] and (r, c) not in known_mines
        ]
        if candidates:
            row, col = random.choice(candidates)
            return {"row": row, "col": col, "action": "reveal"}

        return None

    def board_to_prompt(self, state: dict) -> str:
        board    = state["board"]
        rows, cols = state["rows"], state["cols"]
        revealed = state["revealed"]
        if board is None:
            return "Board not yet generated (first move pending)."
        lines = ["Minesweeper board (? = hidden, * = mine if revealed, number = adjacent mines):"]
        for r in range(rows):
            row_str = ""
            for c in range(cols):
                if revealed[r][c]:
                    row_str += ("*" if board[r][c] == -1 else str(board[r][c])) + " "
                else:
                    row_str += "? "
            lines.append(row_str.rstrip())
        lines.append(f"Move format: {{\"row\": 0-{rows-1}, \"col\": 0-{cols-1}, \"action\": \"reveal\"}}")
        return "\n".join(lines)

    # ── helpers ──────────────────────────────────────────────

    def _generate_board(
        self, safe_row: int, safe_col: int, rows: int, cols: int, mines: int
    ) -> list:
        safe = {
            (safe_row + dr, safe_col + dc)
            for dr in range(-1, 2) for dc in range(-1, 2)
        }
        cells      = [(r, c) for r in range(rows) for c in range(cols) if (r, c) not in safe]
        mine_cells = set(random.sample(cells, min(mines, len(cells))))

        board = [[0] * cols for _ in range(rows)]
        for r, c in mine_cells:
            board[r][c] = -1

        for r in range(rows):
            for c in range(cols):
                if board[r][c] != -1:
                    board[r][c] = sum(
                        1 for dr in range(-1, 2) for dc in range(-1, 2)
                        if (r + dr, c + dc) in mine_cells
                    )
        return board

    def _flood_reveal(
        self, board: list, revealed: list, row: int, col: int, rows: int, cols: int
    ) -> int:
        stack = [(row, col)]
        count = 0
        while stack:
            r, c = stack.pop()
            if not (0 <= r < rows and 0 <= c < cols) or revealed[r][c] or board[r][c] == -1:
                continue
            revealed[r][c] = True
            count += 1
            if board[r][c] == 0:
                for dr in range(-1, 2):
                    for dc in range(-1, 2):
                        if (dr, dc) != (0, 0):
                            stack.append((r + dr, c + dc))
        return count
