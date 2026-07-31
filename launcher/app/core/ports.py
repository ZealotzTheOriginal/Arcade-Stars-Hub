from __future__ import annotations

import re
import socket
from pathlib import Path


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        try:
            sock.bind((host, port))
        except OSError:
            return True
        return False


def find_free_port(start_port: int, max_attempts: int = 30) -> int:
    port = start_port
    for _ in range(max_attempts):
        if not is_port_in_use(port):
            return port
        port += 1
    raise RuntimeError(f"No se encontro un puerto libre a partir de {start_port}")


def read_backend_start_port(env_path: Path, default: int = 8000) -> int:
    if not env_path.exists():
        return default
    match = re.search(r"(?m)^\s*BACKEND_PORT=(\d+)", env_path.read_text(encoding="utf-8"))
    return int(match.group(1)) if match else default
