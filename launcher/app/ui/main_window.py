from __future__ import annotations

import html
import webbrowser
from pathlib import Path

from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.core.env_patcher import patch_frontend_environment
from app.core.ports import find_free_port, read_backend_start_port
from app.core.process_manager import ProcessManager

_STATUS_LABELS = {
    "detenido": ("Detenido", "#3D4553"),
    "preparando": ("Preparando...", "#FFD23D"),
    "iniciando": ("Iniciando...", "#FFD23D"),
    "activo": ("Activo", "#2FE6D8"),
    "error": ("Error", "#FF3B5C"),
}

_LOG_SOURCE_COLORS = {
    "setup": "#3D4553",
    "backend": "#3B82F6",
    "frontend": "#FF5DA2",
}


class MainWindow(QMainWindow):
    def __init__(self, project_root: Path):
        super().__init__()
        self.project_root = project_root
        self.env_path = project_root / ".env"
        self.env_ts_path = project_root / "frontend" / "src" / "environments" / "environment.development.ts"

        self.process_manager = ProcessManager(project_root)
        self.process_manager.log.connect(self._append_log)
        self.process_manager.status_changed.connect(self._on_status_changed)
        self.process_manager.setup_finished.connect(self._on_setup_finished)

        self.setWindowTitle("Arcade Stars Hub — Launcher")
        self.resize(720, 640)
        self._build_ui()

    # ── UI construction ─────────────────────────────────────────────
    def _build_ui(self) -> None:
        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(24, 24, 24, 24)
        root.setSpacing(16)

        title = QLabel("Arcade Stars Hub")
        title.setObjectName("TitleLabel")
        subtitle = QLabel("Launcher local — backend + frontend")
        subtitle.setObjectName("SubtitleLabel")
        root.addWidget(title)
        root.addWidget(subtitle)

        cards_row = QHBoxLayout()
        cards_row.setSpacing(16)
        self.backend_card, self.backend_status_dot, self.backend_status_label, \
            self.backend_url_label, self.backend_open_btn = self._build_service_card(
                "Backend (FastAPI)", "Abrir docs de la API"
            )
        self.frontend_card, self.frontend_status_dot, self.frontend_status_label, \
            self.frontend_url_label, self.frontend_open_btn = self._build_service_card(
                "Frontend (Angular)", "Abrir en el navegador"
            )
        self.backend_open_btn.clicked.connect(self._open_backend_docs)
        self.frontend_open_btn.clicked.connect(self._open_frontend)
        cards_row.addWidget(self.backend_card)
        cards_row.addWidget(self.frontend_card)
        root.addLayout(cards_row)

        ports_row = QHBoxLayout()
        ports_row.setSpacing(24)
        backend_start_port = read_backend_start_port(self.env_path)
        self.backend_port_spin = self._build_port_field(ports_row, "Puerto backend", backend_start_port)
        self.frontend_port_spin = self._build_port_field(ports_row, "Puerto frontend", 4200)
        ports_row.addStretch(1)
        root.addLayout(ports_row)

        buttons_row = QHBoxLayout()
        buttons_row.setSpacing(12)
        self.start_btn = QPushButton("▶  Iniciar todo")
        self.start_btn.setObjectName("PrimaryButton")
        self.start_btn.clicked.connect(self._on_start_clicked)
        self.stop_btn = QPushButton("■  Detener todo")
        self.stop_btn.setObjectName("DangerButton")
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self._on_stop_clicked)
        buttons_row.addWidget(self.start_btn)
        buttons_row.addWidget(self.stop_btn)
        buttons_row.addStretch(1)
        root.addLayout(buttons_row)

        console_label = QLabel("Registro")
        console_label.setObjectName("SectionLabel")
        root.addWidget(console_label)

        self.console = QTextEdit()
        self.console.setObjectName("Console")
        self.console.setReadOnly(True)
        root.addWidget(self.console, 1)

        self.setCentralWidget(central)

    def _build_service_card(self, name: str, open_label: str):
        card = QFrame()
        card.setObjectName("Card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(6)

        name_label = QLabel(name)
        name_label.setObjectName("ServiceName")

        status_row = QHBoxLayout()
        status_dot = QLabel("●")
        status_dot.setStyleSheet(f"color: {_STATUS_LABELS['detenido'][1]};")
        status_label = QLabel(_STATUS_LABELS["detenido"][0])
        status_row.addWidget(status_dot)
        status_row.addWidget(status_label)
        status_row.addStretch(1)

        url_label = QLabel("—")
        url_label.setObjectName("ServiceUrl")

        open_btn = QPushButton(open_label)
        open_btn.setEnabled(False)

        layout.addWidget(name_label)
        layout.addLayout(status_row)
        layout.addWidget(url_label)
        layout.addWidget(open_btn)

        return card, status_dot, status_label, url_label, open_btn

    def _build_port_field(self, parent_layout: QHBoxLayout, label_text: str, default_value: int) -> QSpinBox:
        box = QVBoxLayout()
        label = QLabel(label_text)
        label.setObjectName("SectionLabel")
        spin = QSpinBox()
        spin.setRange(1024, 65535)
        spin.setValue(default_value)
        box.addWidget(label)
        box.addWidget(spin)
        parent_layout.addLayout(box)
        return spin

    # ── Start / stop flow ───────────────────────────────────────────
    def _on_start_clicked(self) -> None:
        if not self.env_path.exists():
            QMessageBox.critical(
                self,
                "Falta .env",
                "No se encontro .env en la raiz del proyecto.\nCopia .env.example a .env y rellena tus valores.",
            )
            return

        self.start_btn.setEnabled(False)
        self.backend_port_spin.setEnabled(False)
        self.frontend_port_spin.setEnabled(False)
        self._on_status_changed("backend", "preparando")
        self._on_status_changed("frontend", "preparando")
        self._append_log("setup", "Comprobando entorno...")
        self.process_manager.run_setup()

    def _on_setup_finished(self, success: bool) -> None:
        if not success:
            self._on_status_changed("backend", "error")
            self._on_status_changed("frontend", "error")
            self.start_btn.setEnabled(True)
            self.backend_port_spin.setEnabled(True)
            self.frontend_port_spin.setEnabled(True)
            return

        backend_port = find_free_port(self.backend_port_spin.value())
        frontend_port = find_free_port(self.frontend_port_spin.value())

        if backend_port != self.backend_port_spin.value():
            self._append_log("setup", f"Puerto backend {self.backend_port_spin.value()} ocupado -> usando {backend_port}")
        if frontend_port != self.frontend_port_spin.value():
            self._append_log("setup", f"Puerto frontend {self.frontend_port_spin.value()} ocupado -> usando {frontend_port}")

        if patch_frontend_environment(self.env_ts_path, backend_port):
            self._append_log("setup", f"environment.development.ts actualizado -> backend en puerto {backend_port}")

        self.backend_url_label.setText(f"http://localhost:{backend_port}")
        self.frontend_url_label.setText(f"http://localhost:{frontend_port}")
        self._backend_port = backend_port
        self._frontend_port = frontend_port

        self._on_status_changed("backend", "iniciando")
        self._on_status_changed("frontend", "iniciando")
        self.process_manager.start_servers(backend_port, frontend_port)
        self.stop_btn.setEnabled(True)

    def _on_stop_clicked(self) -> None:
        self.stop_btn.setEnabled(False)
        self._append_log("setup", "Deteniendo servidores...")
        self.process_manager.stop_servers()
        self.start_btn.setEnabled(True)
        self.backend_port_spin.setEnabled(True)
        self.frontend_port_spin.setEnabled(True)
        self.backend_open_btn.setEnabled(False)
        self.frontend_open_btn.setEnabled(False)

    def _open_backend_docs(self) -> None:
        if hasattr(self, "_backend_port"):
            webbrowser.open(f"http://localhost:{self._backend_port}/docs")

    def _open_frontend(self) -> None:
        if hasattr(self, "_frontend_port"):
            webbrowser.open(f"http://localhost:{self._frontend_port}")

    # ── Signal handlers ─────────────────────────────────────────────
    def _on_status_changed(self, target: str, status: str) -> None:
        label_text, color = _STATUS_LABELS.get(status, (status, "#FFFFFF"))
        if target == "backend":
            dot, label, open_btn = self.backend_status_dot, self.backend_status_label, self.backend_open_btn
        else:
            dot, label, open_btn = self.frontend_status_dot, self.frontend_status_label, self.frontend_open_btn
        dot.setStyleSheet(f"color: {color};")
        label.setText(label_text)
        open_btn.setEnabled(status == "activo")

    def _append_log(self, source: str, line: str) -> None:
        color = _LOG_SOURCE_COLORS.get(source, "#FFFFFF")
        text_color = "#FF3B5C" if "[ERROR]" in line else "#FFFFFF"
        escaped = html.escape(line)
        self.console.append(
            f'<span style="color:{color};">[{source.upper()}]</span> '
            f'<span style="color:{text_color};">{escaped}</span>'
        )

    # ── Lifecycle ────────────────────────────────────────────────────
    def closeEvent(self, event) -> None:
        if self.process_manager.is_running():
            self.process_manager.stop_servers()
        event.accept()
