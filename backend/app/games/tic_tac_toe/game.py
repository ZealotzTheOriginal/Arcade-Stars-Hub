import random
from typing import Any, Optional
from app.games.base import BaseGame

SIZE = 3
MAX_PIECES = 3  # "vanishing" tic-tac-toe: each player keeps at most this many
                 # pieces on the board — placing a 4th removes their oldest one.


class TicTacToeGame(BaseGame):

    def get_initial_state(self, player_uids: list[str]) -> dict:
        return {
            "board": [[0] * SIZE for _ in range(SIZE)],
            "players": player_uids,
            "current_turn": player_uids[0],
            "winner": None,
            "draw": False,
            "piece_queues": {uid: [] for uid in player_uids},
        }

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        if state["current_turn"] != uid:
            raise ValueError("Not your turn")
        row, col = int(move["row"]), int(move["col"])
        if not (0 <= row < SIZE and 0 <= col < SIZE):
            raise ValueError("Cell out of bounds")

        board = [r[:] for r in state["board"]]
        if board[row][col] != 0:
            raise ValueError("Cell already taken")

        piece = state["players"].index(uid) + 1
        queues = {k: [list(cell) for cell in v] for k, v in state.get("piece_queues", {}).items()}
        my_queue = queues.setdefault(uid, [])

        # Vanishing rule: placing a 4th piece removes your oldest one first,
        # so a player never has more than MAX_PIECES on the board at once.
        if len(my_queue) >= MAX_PIECES:
            old_row, old_col = my_queue.pop(0)
            board[old_row][old_col] = 0

        my_queue.append([row, col])
        board[row][col] = piece

        winner = uid if self._check_win(board, piece) else None
        # A draw by "full board" is structurally impossible here — with at
        # most MAX_PIECES per player, at most 2*MAX_PIECES of the 9 cells
        # can ever be occupied at once — so `draw` is kept only for the
        # BaseGame interface and simply never becomes true.

        players = state["players"]
        next_turn = players[1] if uid == players[0] else players[0]

        return {
            **state,
            "board": board,
            "piece_queues": queues,
            "current_turn": next_turn if not winner else uid,
            "winner": winner,
            "draw": False,
        }

    def is_terminal(self, state: dict) -> bool:
        return state["winner"] is not None or state["draw"]

    def get_winner(self, state: dict) -> Optional[str]:
        return state.get("winner")

    def get_scores(self, state: dict) -> dict[str, int]:
        winner = state.get("winner")
        if winner:
            loser = [p for p in state["players"] if p != winner][0]
            return {winner: 50, loser: 5}
        return {p: 15 for p in state["players"]}

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        if self.is_terminal(state) or state["current_turn"] != uid:
            return []
        board = state["board"]
        return [{"row": r, "col": c} for r in range(SIZE) for c in range(SIZE) if board[r][c] == 0]

    def get_best_move(self, state: dict) -> Any:
        """Heuristic AI, not exhaustive search: the vanishing-piece rule means
        the game tree has no natural depth bound (pieces keep rotating), so
        minimax doesn't apply cleanly here. Plays well without solving it
        perfectly — win now, block an immediate loss, then a positional
        preference (center > corner > edge)."""
        players = state["players"]
        ai_uids = [p for p in players if p.startswith("AI_")]
        if len(ai_uids) != 1 or len(players) != 2:
            return None
        ai_uid = ai_uids[0]
        human_uid = next(p for p in players if p != ai_uid)

        board = state["board"]
        empty = [(r, c) for r in range(SIZE) for c in range(SIZE) if board[r][c] == 0]
        if not empty:
            return None

        for (r, c) in empty:
            if self._would_win(state, ai_uid, r, c):
                return {"row": r, "col": c}

        for (r, c) in empty:
            if self._would_win(state, human_uid, r, c):
                return {"row": r, "col": c}

        if (1, 1) in empty:
            return {"row": 1, "col": 1}

        corners = [(0, 0), (0, 2), (2, 0), (2, 2)]
        empty_corners = [cell for cell in corners if cell in empty]
        if empty_corners:
            r, c = random.choice(empty_corners)
            return {"row": r, "col": c}

        r, c = random.choice(empty)
        return {"row": r, "col": c}

    def _would_win(self, state: dict, uid: str, row: int, col: int) -> bool:
        """Simulates uid's next placement at (row, col) — including the
        vanishing-piece removal if they're already at the cap — and reports
        whether that specific move completes a line for them."""
        board = [r[:] for r in state["board"]]
        piece = state["players"].index(uid) + 1
        queue = state.get("piece_queues", {}).get(uid, [])
        if len(queue) >= MAX_PIECES:
            old_row, old_col = queue[0]
            board[old_row][old_col] = 0
        board[row][col] = piece
        return self._check_win(board, piece)

    def board_to_prompt(self, state: dict) -> str:
        board = state["board"]
        symbols = {0: ".", 1: "X", 2: "O"}
        lines = [
            "Vanishing Tic-Tac-Toe board (3x3): each player keeps at most "
            f"{MAX_PIECES} pieces on the board — placing a new one removes "
            "their own oldest piece first if they're already at the cap.",
        ]
        for r, row in enumerate(board):
            lines.append(f"Row {r}: " + " ".join(symbols[cell] for cell in row))
        lines.append("Move format: {\"row\": 0-2, \"col\": 0-2}")
        return "\n".join(lines)

    # ── helpers ──────────────────────────────────────────

    def _check_win(self, board: list, piece: int) -> bool:
        for i in range(SIZE):
            if all(board[i][j] == piece for j in range(SIZE)):
                return True
            if all(board[j][i] == piece for j in range(SIZE)):
                return True
        if all(board[i][i] == piece for i in range(SIZE)):
            return True
        if all(board[i][SIZE - 1 - i] == piece for i in range(SIZE)):
            return True
        return False
