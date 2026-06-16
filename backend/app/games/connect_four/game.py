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

    def get_best_move(self, state: dict) -> Any:
        _AI_UID = "AI_PLAYER"
        players = state["players"]
        if _AI_UID not in players:
            return None
        ai_piece = players.index(_AI_UID) + 1
        human_piece = 3 - ai_piece
        board = [row[:] for row in state["board"]]
        col_order = sorted(range(COLS), key=lambda c: abs(c - COLS // 2))

        # Immediate win
        for col in col_order:
            row = self._drop_row(board, col)
            if row == -1:
                continue
            board[row][col] = ai_piece
            wins = self._check_win(board, row, col, ai_piece)
            board[row][col] = 0
            if wins:
                return col

        # Block opponent win
        for col in col_order:
            row = self._drop_row(board, col)
            if row == -1:
                continue
            board[row][col] = human_piece
            wins = self._check_win(board, row, col, human_piece)
            board[row][col] = 0
            if wins:
                return col

        # Alpha-beta search
        best_score, best_col = float("-inf"), col_order[0]
        for col in col_order:
            row = self._drop_row(board, col)
            if row == -1:
                continue
            board[row][col] = ai_piece
            score = self._alphabeta(board, 4, float("-inf"), float("inf"), False, ai_piece, human_piece)
            board[row][col] = 0
            if score > best_score:
                best_score, best_col = score, col
        return best_col

    def _alphabeta(self, board, depth, alpha, beta, is_max, ai_piece, human_piece):
        valid = [c for c in range(COLS) if board[0][c] == 0]
        if not valid:
            return 0
        if depth == 0:
            return self._score_board(board, ai_piece, human_piece)

        if is_max:
            value = float("-inf")
            for col in sorted(valid, key=lambda c: abs(c - COLS // 2)):
                row = self._drop_row(board, col)
                board[row][col] = ai_piece
                if self._check_win(board, row, col, ai_piece):
                    board[row][col] = 0
                    return 1_000_000 + depth
                value = max(value, self._alphabeta(board, depth - 1, alpha, beta, False, ai_piece, human_piece))
                board[row][col] = 0
                alpha = max(alpha, value)
                if alpha >= beta:
                    break
            return value
        else:
            value = float("inf")
            for col in sorted(valid, key=lambda c: abs(c - COLS // 2)):
                row = self._drop_row(board, col)
                board[row][col] = human_piece
                if self._check_win(board, row, col, human_piece):
                    board[row][col] = 0
                    return -(1_000_000 + depth)
                value = min(value, self._alphabeta(board, depth - 1, alpha, beta, True, ai_piece, human_piece))
                board[row][col] = 0
                beta = min(beta, value)
                if alpha >= beta:
                    break
            return value

    def _score_board(self, board, ai_piece, human_piece):
        score = board[ROWS // 2 + 1][COLS // 2] == ai_piece and 6 or 0
        center = [board[r][COLS // 2] for r in range(ROWS)]
        score += center.count(ai_piece) * 3

        def _window_score(window):
            ai_c = window.count(ai_piece)
            empty = window.count(0)
            hu_c = window.count(human_piece)
            if ai_c == 3 and empty == 1:
                return 5
            if ai_c == 2 and empty == 2:
                return 2
            if hu_c == 3 and empty == 1:
                return -4
            return 0

        for r in range(ROWS):
            for c in range(COLS - 3):
                score += _window_score([board[r][c + i] for i in range(4)])
        for r in range(ROWS - 3):
            for c in range(COLS):
                score += _window_score([board[r + i][c] for i in range(4)])
        for r in range(ROWS - 3):
            for c in range(COLS - 3):
                score += _window_score([board[r + i][c + i] for i in range(4)])
        for r in range(3, ROWS):
            for c in range(COLS - 3):
                score += _window_score([board[r - i][c + i] for i in range(4)])
        return score

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
