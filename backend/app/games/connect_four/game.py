from typing import Any, Optional
from app.games.base import BaseGame

ROWS, COLS = 6, 7
WIN_LEN = 4


class ConnectFourGame(BaseGame):

    def get_initial_state(self, player_uids: list[str]) -> dict:
        return {
            "board": [[0] * COLS for _ in range(ROWS)],
            "players": player_uids,
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

        win_cells: list[list[int]] = []
        if state.get("game_mode") == "teams":
            teams = state.get("teams", {"a": [], "b": []})
            piece_team: dict[int, str] = {}
            for i, p_uid in enumerate(state["players"]):
                p = i + 1
                if p_uid in teams.get("a", []):
                    piece_team[p] = "a"
                elif p_uid in teams.get("b", []):
                    piece_team[p] = "b"
            cells = self._find_win_cells_team(board, row, col, piece, piece_team)
            if cells:
                winner = uid
                win_cells = cells
        else:
            cells = self._find_win_cells(board, row, col, piece)
            if cells:
                winner = uid
                win_cells = cells

        if not winner and all(board[0][c] != 0 for c in range(COLS)):
            draw = True

        players = state["players"]
        current_idx = players.index(uid)
        next_idx = (current_idx + 1) % len(players)
        next_turn = players[next_idx]

        return {
            **state,
            "board": board,
            "current_turn": next_turn if not winner and not draw else uid,
            "winner": winner,
            "win_cells": win_cells,
            "draw": draw,
            "move_count": state["move_count"] + 1,
        }

    def is_terminal(self, state: dict) -> bool:
        return state["winner"] is not None or state["draw"]

    def get_winner(self, state: dict) -> Optional[str]:
        return state.get("winner")

    def get_scores(self, state: dict) -> dict[str, int]:
        winner = state.get("winner")
        players = state["players"]
        if winner and state.get("game_mode") == "teams":
            teams = state.get("teams", {"a": [], "b": []})
            winning_team = "a" if winner in teams.get("a", []) else ("b" if winner in teams.get("b", []) else None)
            if winning_team:
                return {p: (100 if p in teams.get(winning_team, []) else 10) for p in players}
        if winner:
            return {p: (100 if p == winner else 10) for p in players}
        return {p: 25 for p in players}  # draw

    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        if self.is_terminal(state) or state["current_turn"] != uid:
            return []
        board = state["board"]
        return [c for c in range(COLS) if board[0][c] == 0]

    def get_best_move(self, state: dict) -> Any:
        players = state["players"]
        ai_uids = [p for p in players if p.startswith("AI_")]
        if len(ai_uids) != 1 or len(players) != 2:
            return None  # minimax only for classic 1v1
        ai_piece = players.index(ai_uids[0]) + 1
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
        piece_chars = [".", "X", "O", "A", "B"]  # supports up to 4 players
        lines = ["Connect Four board (rows top→bottom, cols 0-6):"]
        for row in board:
            lines.append(" ".join(piece_chars[cell] if cell < len(piece_chars) else str(cell) for cell in row))
        lines.append("Column indices: 0 1 2 3 4 5 6")
        return "\n".join(lines)

    # ── helpers ──────────────────────────────────────────

    def _check_win_team(self, board: list, row: int, col: int, piece: int, piece_team: dict) -> bool:
        """Win check that treats same-team pieces as equivalent."""
        team = piece_team.get(piece)
        if team is None:
            return self._check_win(board, row, col, piece)
        directions = [(0, 1), (1, 0), (1, 1), (1, -1)]
        for dr, dc in directions:
            count = 1
            for sign in (1, -1):
                r, c = row + sign * dr, col + sign * dc
                while 0 <= r < ROWS and 0 <= c < COLS:
                    cell = board[r][c]
                    if cell != 0 and piece_team.get(cell) == team:
                        count += 1
                        r += sign * dr
                        c += sign * dc
                    else:
                        break
            if count >= WIN_LEN:
                return True
        return False

    def _drop_row(self, board: list, col: int) -> int:
        for r in range(ROWS - 1, -1, -1):
            if board[r][col] == 0:
                return r
        return -1

    def _check_win(self, board: list, row: int, col: int, piece: int) -> bool:
        return self._find_win_cells(board, row, col, piece) is not None

    def _find_win_cells(self, board: list, row: int, col: int, piece: int) -> list[list[int]] | None:
        directions = [(0, 1), (1, 0), (1, 1), (1, -1)]
        for dr, dc in directions:
            cells = [[row, col]]
            for sign in (1, -1):
                r, c = row + sign * dr, col + sign * dc
                while 0 <= r < ROWS and 0 <= c < COLS and board[r][c] == piece:
                    cells.append([r, c])
                    r += sign * dr
                    c += sign * dc
            if len(cells) >= WIN_LEN:
                return cells
        return None

    def _find_win_cells_team(self, board: list, row: int, col: int, piece: int, piece_team: dict) -> list[list[int]] | None:
        team = piece_team.get(piece)
        if team is None:
            return self._find_win_cells(board, row, col, piece)
        directions = [(0, 1), (1, 0), (1, 1), (1, -1)]
        for dr, dc in directions:
            cells = [[row, col]]
            for sign in (1, -1):
                r, c = row + sign * dr, col + sign * dc
                while 0 <= r < ROWS and 0 <= c < COLS:
                    cell = board[r][c]
                    if cell != 0 and piece_team.get(cell) == team:
                        cells.append([r, c])
                        r += sign * dr
                        c += sign * dc
                    else:
                        break
            if len(cells) >= WIN_LEN:
                return cells
        return None
