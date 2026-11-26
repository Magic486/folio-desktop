# -*- mode: python ; coding: utf-8 -*-
from importlib.metadata import distributions
from pathlib import Path
import sys

root = Path(SPECPATH)
assets = [(str(root / name), ".") for name in (
    "index.html", "styles.css", "app.js", "views.js", "ai.js", "workspace.js", "evidence.js", "transfer.js",
    "folders.js", "folder_ocr.ps1",
)]
assets.append((str(root / "assets"), "assets"))
assets.append((str(Path(sys.base_prefix) / "LICENSE.txt"), "notices/Python"))
for package in distributions():
    for item in package.files or []:
        if not any(part.lower().startswith(("license", "copying", "notice", "authors"))
                   for part in item.parts[1:]):
            continue
        path = Path(package.locate_file(item))
        if path.is_file() and ".." not in item.parts:
            assets.append((str(path), str(Path("notices", package.metadata["Name"], *item.parts[1:-1]))))

a = Analysis([str(root / "desktop.py")], pathex=[str(root)], datas=assets,
             hiddenimports=["webview.platforms.edgechromium", "webview.platforms.winforms"],
             excludes=["tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "numpy"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="Folio", console=False, upx=False,
          icon=str(root / "assets" / "folio.ico"))
