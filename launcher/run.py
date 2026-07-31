from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QApplication

from app.ui.main_window import MainWindow


def main() -> int:
    QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    launcher_dir = Path(__file__).parent
    app = QApplication(sys.argv)
    # The native Windows style only partially honors stylesheet properties
    # like border-radius on QPushButton; Fusion renders everything through
    # the stylesheet engine, matching the design pixel-for-pixel.
    app.setStyle("Fusion")

    theme_path = launcher_dir / "app" / "ui" / "theme.qss"
    app.setStyleSheet(theme_path.read_text(encoding="utf-8"))

    # launcher/ lives one level inside the ASH repo; backend/, frontend/ and
    # .env are siblings of launcher/ at the project root.
    project_root = launcher_dir.parent

    window = MainWindow(project_root)
    window.show()

    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
