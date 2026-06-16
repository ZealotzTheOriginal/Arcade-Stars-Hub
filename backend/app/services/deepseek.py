import json
import random
import httpx
from app.core.config import settings
from app.games.base import BaseGame

AI_UID = "AI_PLAYER"

_SYSTEM_PROMPT = """\
You are a competitive but fair game-playing AI.
Given the current board state, return ONLY valid JSON with a single key "move"
containing your chosen move in the format specified. No explanation, no markdown.
"""


async def get_ai_move(game: BaseGame, state: dict) -> dict:
    """Use game-specific algorithm first; fall back to DeepSeek LLM, then random."""
    valid_moves = game.get_valid_moves(state, AI_UID)
    if not valid_moves:
        raise ValueError("No valid moves for AI")

    # Prefer deterministic game algorithm (minimax / CSP)
    best = game.get_best_move(state)
    if best is not None:
        return best

    board_text = game.board_to_prompt(state)
    user_msg = f"{board_text}\n\nYou are player O (piece 2). Pick your best move from the valid options: {json.dumps(valid_moves)}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.deepseek_base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={
                    "model": settings.deepseek_model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 64,
                },
            )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        parsed = json.loads(content)
        move = parsed["move"]
        if move in valid_moves or (isinstance(move, dict) and move in valid_moves):
            return move
        # validate move is in valid list
        if isinstance(move, int) and move in valid_moves:
            return move
        return random.choice(valid_moves)
    except Exception:
        return random.choice(valid_moves)
