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
        board       = state.get("board")
        rows, cols  = state["rows"], state["cols"]
        revealed    = state["revealed"]
        flagged     = state.get("flagged", [[False] * cols for _ in range(rows)])
        total_mines = state["mines"]

        if board is None:
            return {"row": rows // 2, "col": cols // 2, "action": "reveal"}

        known_safe: set[tuple[int, int]] = set()
        known_mines: set[tuple[int, int]] = set()

        def _constraints() -> list[tuple[frozenset, int]]:
            """Constraints from all revealed numbered cells, adjusted for known deductions."""
            result = []
            for r in range(rows):
                for c in range(cols):
                    if not revealed[r][c] or board[r][c] <= 0:
                        continue
                    nbrs = [
                        (r + dr, c + dc)
                        for dr in range(-1, 2) for dc in range(-1, 2)
                        if (dr, dc) != (0, 0) and 0 <= r + dr < rows and 0 <= c + dc < cols
                    ]
                    fl  = sum(1 for nr, nc in nbrs if flagged[nr][nc])
                    km  = sum(1 for nr, nc in nbrs if (nr, nc) in known_mines and not flagged[nr][nc])
                    unk = frozenset(
                        (nr, nc) for nr, nc in nbrs
                        if not revealed[nr][nc]
                        and not flagged[nr][nc]
                        and (nr, nc) not in known_mines
                        and (nr, nc) not in known_safe
                    )
                    rem = board[r][c] - fl - km
                    if unk and 0 <= rem <= len(unk):
                        result.append((unk, rem))
            return result

        # ── Iterative constraint deduction ───────────────────
        for _ in range(50):
            changed = False
            cons = _constraints()

            # Pass 1: saturation (rem==0 → all safe) and completeness (rem==|cells| → all mines)
            for cells, rem in cons:
                if rem == 0 and (cells - known_safe):
                    known_safe.update(cells)
                    changed = True
                if rem == len(cells) and (cells - known_mines):
                    known_mines.update(cells)
                    changed = True

            # Pass 2: subset deduction — if A ⊂ B then (B\A) contains exactly (B.rem − A.rem) mines
            for i, (ca, ra) in enumerate(cons):
                for j, (cb, rb) in enumerate(cons):
                    if i == j or not ca or not cb:
                        continue
                    if ca < cb:                    # strict subset
                        diff   = cb - ca
                        diff_r = rb - ra
                        if not (0 <= diff_r <= len(diff)):
                            continue
                        if diff_r == 0 and (diff - known_safe):
                            known_safe.update(diff)
                            changed = True
                        if diff_r == len(diff) and (diff - known_mines):
                            known_mines.update(diff)
                            changed = True

            if not changed:
                break

        cons = _constraints()    # rebuild after all deductions

        # ── Priority 1: flag a known mine ────────────────────
        for r, c in known_mines:
            if not flagged[r][c]:
                return {"row": r, "col": c, "action": "flag"}

        # ── Priority 2: reveal a known safe cell ─────────────
        if known_safe:
            r, c = next(iter(known_safe))
            return {"row": r, "col": c, "action": "reveal"}

        # ── Priority 3: probability-based guess ──────────────
        flagged_count = sum(flagged[r][c] for r in range(rows) for c in range(cols))
        mines_left    = total_mines - flagged_count - len(known_mines)

        all_unknown = [
            (r, c) for r in range(rows) for c in range(cols)
            if not revealed[r][c] and not flagged[r][c] and (r, c) not in known_mines
        ]
        if not all_unknown:
            return None

        # Mine-probability samples from each constraint
        samples: dict[tuple, list[float]] = {}
        constrained: set[tuple] = set()
        for cells, rem in cons:
            if not cells:
                continue
            p = rem / len(cells)
            constrained.update(cells)
            for cell in cells:
                samples.setdefault(cell, []).append(p)

        frontier_prob = {cell: sum(ps) / len(ps) for cell, ps in samples.items()}

        # Global probability for cells not adjacent to any revealed cell
        unknown_set    = set(all_unknown)
        n_interior     = sum(1 for c in all_unknown if c not in constrained)
        expected_fm    = sum(frontier_prob.get(c, 0) for c in constrained if c in unknown_set)
        interior_mines = max(0.0, mines_left - expected_fm)
        global_prob    = min(1.0, interior_mines / max(1, n_interior)) if n_interior else 1.0

        prob_map = {
            cell: frontier_prob.get(cell, global_prob)
            for cell in all_unknown
        }

        best = min(prob_map, key=prob_map.get)
        r, c = best
        return {"row": r, "col": c, "action": "reveal"}

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
