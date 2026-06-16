from abc import ABC, abstractmethod
from typing import Any, Optional


class BaseGame(ABC):
    """All games must implement this interface."""

    @abstractmethod
    def get_initial_state(self, player_uids: list[str]) -> dict:
        """Return the initial game state dict."""

    @abstractmethod
    def apply_move(self, state: dict, uid: str, move: Any) -> dict:
        """Apply move and return updated state. Raise ValueError on illegal move."""

    @abstractmethod
    def is_terminal(self, state: dict) -> bool:
        """True when the game has ended."""

    @abstractmethod
    def get_winner(self, state: dict) -> Optional[str]:
        """Return winning uid, or None for draw / still in play."""

    @abstractmethod
    def get_scores(self, state: dict) -> dict[str, int]:
        """Return {uid: points_earned} for this match."""

    @abstractmethod
    def get_valid_moves(self, state: dict, uid: str) -> list[Any]:
        """Return list of valid moves for the given player."""

    def board_to_prompt(self, state: dict) -> str:
        """Optional: human-readable board for DeepSeek prompts."""
        return str(state)

    def get_best_move(self, state: dict) -> Any:
        """Override to provide deterministic AI logic. None = use DeepSeek."""
        return None
