from __future__ import annotations

import re
from pathlib import Path


def patch_frontend_environment(env_ts_path: Path, backend_port: int) -> bool:
    """Rewrite apiUrl/wsUrl in environment.development.ts to the real backend port.

    Only the port-bearing lines are touched, and the file is left untouched
    when the resolved port already matches what's on disk (the common case).
    Returns True if the file was modified.
    """
    if not env_ts_path.exists():
        return False

    original = env_ts_path.read_text(encoding="utf-8")
    updated = re.sub(
        r"apiUrl:\s*'http://localhost:\d+/api'",
        f"apiUrl: 'http://localhost:{backend_port}/api'",
        original,
    )
    updated = re.sub(
        r"wsUrl:\s*'ws://localhost:\d+/ws'",
        f"wsUrl: 'ws://localhost:{backend_port}/ws'",
        updated,
    )

    if updated != original:
        env_ts_path.write_text(updated, encoding="utf-8")
        return True
    return False
