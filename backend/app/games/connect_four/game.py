from typing import Any, Optional
from app.games.base import BaseGame

ROWS, COLS = 6, 7
WIN_LEN = 4


class ConnectFourGame(BaseGame):

    def get_initial_state(self, player_uids: list[str]) -> dict:
        return {
            "board": [[0] * COLS for _ in range(ROWS)],
            "players": player_uids,          # [uid_p1, uid_p2]
            "current_turn": player_uids[0],
            "winner": None,
            "draw": False,
            "move_count": 0,
        }

    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        if state["current_turn"] != uid:
            raise ValueError("Not your turn")
        col = int(move)
        if col < 0 or col >= COLS:
            raise ValueError("Column out of range")

        board = [row[:] for row in state["board"]]
        piece = state["players"].index(uid) + 1

        row = self._drop_row(board, col)
        if row == -1:
            raise ValueError("Column is full")

        board[row][col] = piece
        winner = None
        draw = False
        if self._check_win(board, row, col, piece):
            winner = uid
        elif all(board[0][c] != 0 for c in range(COLS)):
            draw = True

        players = state["players"]
        next_turn = players[1] if uid == players[0] else players[0]

        return {
            **state,
            "board": board,
            "current_turn": next_turn if not winner and not draw else uid,
            "winner": winner,
            "draw": draw,
            "move_count": state["move_count"] + 1,
        }

    def is_terminal(self, state: dict) -> bool:
        return state["winner"] is not None or state["draw"]

    def get_winner(self, state: dict) -> Optional[str]:
        return state.get("winner")

    def get_scores(self, state: dict) -> dict[str, int]:
        winner = state.get("winner")
        if winner:
            loser = [p for p in state["players"] if p != winner][0]
            return {winner: 100, loser: 10}
        return {p: 25 for p in state["players"]}  # draw

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        if self.is_terminal(state) or state["current_turn"] != uid:
            return []
        board = state["board"]
        return [c for c in range(COLS) if board[0][c] == 0]

    def board_to_prompt(self, state: dict) -> str:
        board = state["board"]
        symbols = {0: ".", 1: "X", 2: "O"}
        lines = ["Connect Four board (rows top→bottom, cols 0-6):"]
        for row in board:
            lines.append(" ".join(symbols[cell] for cell in row))
        lines.append("Column indices: 0 1 2 3 4 5 6")
        return "\n".join(lines)

    # ── helpers ──────────────────────────────────────────

    def _drop_row(self, board: list, col: int) -> int:
        for r in range(ROWS - 1, -1, -1):
            if board[r][col] == 0:
                return r
        return -1

    def _check_win(self, board: list, row: int, col: int, piece: int) -> bool:
        directions = [(0, 1), (1, 0), (1, 1), (1, -1)]
        for dr, dc in directions:
            count = 1
            for sign in (1, -1):
                r, c = row + sign * dr, col + sign * dc
                while 0 <= r < ROWS and 0 <= c < COLS and board[r][c] == piece:
                    count += 1
                    r += sign * dr
                    c += sign * dc
            if count >= WIN_LEN:
                return True
        return False
