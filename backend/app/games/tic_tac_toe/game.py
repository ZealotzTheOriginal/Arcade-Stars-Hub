from typing import Any, Optional
from app.games.base import BaseGame

SIZE = 3


class TicTacToeGame(BaseGame):

    def get_initial_state(self, player_uids: list[str]) -> dict:
        return {
            "board": [[0] * SIZE for _ in range(SIZE)],
            "players": player_uids,
            "current_turn": player_uids[0],
            "winner": None,
            "draw": False,
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
        board[row][col] = piece

        winner = None
        draw = False
        if self._check_win(board, piece):
            winner = uid
        elif all(board[r][c] != 0 for r in range(SIZE) for c in range(SIZE)):
            draw = True

        players = state["players"]
        next_turn = players[1] if uid == players[0] else players[0]

        return {
            **state,
            "board": board,
            "current_turn": next_turn if not winner and not draw else uid,
            "winner": winner,
            "draw": draw,
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

    def board_to_prompt(self, state: dict) -> str:
        board = state["board"]
        symbols = {0: ".", 1: "X", 2: "O"}
        lines = ["Tic-Tac-Toe board (3x3):"]
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
