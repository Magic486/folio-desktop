"""Windows desktop entry point for Folio."""

import ctypes
import os
import threading
from ctypes import wintypes
from pathlib import Path

from serve import ROOT, create_server


TITLE = "拾页 Folio"
PORT = 52845  # Part of the permanent origin used by IndexedDB.


def main():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    mutex = kernel.CreateMutexW(None, False, r"Local\Magic486.Folio.Desktop")
    if not mutex:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            user = ctypes.windll.user32
            user.FindWindowW.restype = wintypes.HWND
            window = user.FindWindowW(None, TITLE)
            if window:
                if user.IsIconic(wintypes.HWND(window)):
                    user.ShowWindow(wintypes.HWND(window), 9)
                user.SetForegroundWindow(wintypes.HWND(window))
            return
        import webview

        data = Path(os.environ["LOCALAPPDATA"]) / "FolioDesktop"
        try:
            server = create_server(PORT, data / "connection", desktop=True)
        except OSError as exc:
            raise RuntimeError(f"无法启动本机服务。请确认端口 {PORT} 可用后重试。") from exc
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Magic486.Folio.Desktop")
            webview.settings["ALLOW_DOWNLOADS"] = True
            webview.settings["ALLOW_FILE_URLS"] = False
            webview.create_window(TITLE, f"http://127.0.0.1:{PORT}/", width=1180, height=820,
                                  min_size=(640, 480), text_select=True, background_color="#f8faf7")
            webview.start(gui="edgechromium", private_mode=False, storage_path=str(data / "workspace"),
                          icon=str(ROOT / "assets" / "folio.ico"))
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
    finally:
        kernel.CloseHandle(mutex)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        ctypes.windll.user32.MessageBoxW(None, f"拾页启动失败。\n{exc}\n\n请确认已安装 Microsoft Edge WebView2 运行时。", TITLE, 0x10)
        raise SystemExit(1)
