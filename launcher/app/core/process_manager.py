from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from PySide6.QtCore import QObject, QProcess, Signal


class ProcessManager(QObject):
    """Owns the backend/frontend child processes and the one-off setup steps.

    All process handling goes through QProcess (async, non-blocking) so the
    GUI thread never stalls waiting on pip/npm/uvicorn.
    """

    log = Signal(str, str)              # source ("setup"/"backend"/"frontend"), line
    status_changed = Signal(str, str)   # target ("backend"/"frontend"), status
    setup_finished = Signal(bool)

    def __init__(self, project_root: Path):
        super().__init__()
        self.project_root = project_root
        self.backend_dir = project_root / "backend"
        self.frontend_dir = project_root / "frontend"
        self.venv_python = self.backend_dir / ".venv" / "Scripts" / "python.exe"

        self._setup_queue: list[dict[str, Any]] = []
        self.backend_proc: QProcess | None = None
        self.frontend_proc: QProcess | None = None

    # ── Setup (venv / pip / npm install, only what's missing) ──────────
    def run_setup(self) -> None:
        steps: list[dict[str, Any]] = []

        if not self.venv_python.exists():
            steps.append({
                "label": "Creando entorno virtual del backend...",
                "program": sys.executable,
                "args": ["-m", "venv", str(self.backend_dir / ".venv")],
                "cwd": self.project_root,
            })

        steps.append({
            "label": "Instalando dependencias del backend...",
            "program": str(self.venv_python),
            "args": ["-m", "pip", "install", "-r", str(self.backend_dir / "requirements.txt"), "--quiet"],
            "cwd": self.backend_dir,
        })

        if not (self.frontend_dir / "node_modules").exists():
            steps.append({
                "label": "Instalando dependencias del frontend (npm install)...",
                "program": "cmd.exe",
                "args": ["/c", "npm", "install", "--silent"],
                "cwd": self.frontend_dir,
            })

        self._setup_queue = steps
        self._run_next_setup_step()

    def _run_next_setup_step(self) -> None:
        if not self._setup_queue:
            self.setup_finished.emit(True)
            return

        step = self._setup_queue.pop(0)
        self.log.emit("setup", step["label"])

        proc = QProcess(self)
        proc.setWorkingDirectory(str(step["cwd"]))
        proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        proc.readyReadStandardOutput.connect(lambda p=proc: self._emit_output(p, "setup"))
        proc.finished.connect(lambda code, _status, s=step: self._on_setup_step_finished(code, s))
        proc.errorOccurred.connect(lambda err, s=step: self._on_setup_step_error(err, s))
        proc.start(step["program"], step["args"])

    def _on_setup_step_finished(self, exit_code: int, step: dict[str, Any]) -> None:
        if exit_code != 0:
            self.log.emit("setup", f"[ERROR] Fallo: {step['label']} (codigo {exit_code})")
            self.setup_finished.emit(False)
            return
        self._run_next_setup_step()

    def _on_setup_step_error(self, error: QProcess.ProcessError, step: dict[str, Any]) -> None:
        self.log.emit("setup", f"[ERROR] No se pudo ejecutar '{step['program']}': {error}")
        self.setup_finished.emit(False)

    # ── Servers ──────────────────────────────────────────────────────
    def start_servers(self, backend_port: int, frontend_port: int) -> None:
        self.backend_proc = QProcess(self)
        self.backend_proc.setWorkingDirectory(str(self.backend_dir))
        self.backend_proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        self.backend_proc.readyReadStandardOutput.connect(
            lambda: self._emit_output(self.backend_proc, "backend")
        )
        self.backend_proc.started.connect(lambda: self.status_changed.emit("backend", "activo"))
        self.backend_proc.finished.connect(lambda *_: self._on_server_finished("backend"))
        self.backend_proc.errorOccurred.connect(lambda *_: self._on_server_finished("backend"))

        self.frontend_proc = QProcess(self)
        self.frontend_proc.setWorkingDirectory(str(self.frontend_dir))
        self.frontend_proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        self.frontend_proc.readyReadStandardOutput.connect(
            lambda: self._emit_output(self.frontend_proc, "frontend")
        )
        self.frontend_proc.started.connect(lambda: self.status_changed.emit("frontend", "activo"))
        self.frontend_proc.finished.connect(lambda *_: self._on_server_finished("frontend"))
        self.frontend_proc.errorOccurred.connect(lambda *_: self._on_server_finished("frontend"))

        self.backend_proc.start(str(self.venv_python), [
            "-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", str(backend_port),
        ])
        self.frontend_proc.start("cmd.exe", [
            "/c", "npm", "run", "start", "--", "--port", str(frontend_port),
        ])

    def stop_servers(self) -> None:
        for proc in (self.backend_proc, self.frontend_proc):
            if proc is not None and proc.state() != QProcess.ProcessState.NotRunning:
                pid = proc.processId()
                if pid:
                    # taskkill /T kills the whole tree: cmd.exe -> npm -> node,
                    # or python.exe -> uvicorn's --reload worker subprocess.
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)

    def is_running(self) -> bool:
        return any(
            proc is not None and proc.state() != QProcess.ProcessState.NotRunning
            for proc in (self.backend_proc, self.frontend_proc)
        )

    # ── Helpers ──────────────────────────────────────────────────────
    def _emit_output(self, proc: QProcess | None, source: str) -> None:
        if proc is None:
            return
        data = bytes(proc.readAllStandardOutput()).decode("utf-8", errors="replace")
        for line in data.splitlines():
            if line.strip():
                self.log.emit(source, line)

    def _on_server_finished(self, target: str) -> None:
        self.status_changed.emit(target, "detenido")
        if target == "backend":
            self.backend_proc = None
        else:
            self.frontend_proc = None
