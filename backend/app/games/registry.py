from app.games.base import BaseGame
from app.models.game_room import GameDefinition

_registry: dict[str, BaseGame] = {}
_definitions: dict[str, GameDefinition] = {}


def register(definition: GameDefinition, instance: BaseGame):
    _registry[definition.id] = instance
    _definitions[definition.id] = definition


def get_game(game_id: str) -> BaseGame:
    game = _registry.get(game_id)
    if not game:
        raise KeyError(f"Unknown game: {game_id}")
    return game


def list_games() -> list[GameDefinition]:
    return list(_definitions.values())


def get_definition(game_id: str) -> GameDefinition:
    defn = _definitions.get(game_id)
    if not defn:
        raise KeyError(f"Unknown game: {game_id}")
    return defn
