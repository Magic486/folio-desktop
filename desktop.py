"""Windows desktop entry point for Folio."""

import ctypes
import os
import sys
import threading
from ctypes import wintypes
from pathlib import Path

from serve import ROOT, create_server


TITLE = "拾页 Folio"
PORT = 52845  # Part of the permanent origin used by IndexedDB.
TOPBAR_COLOR = "#fafbf8"
TITLE_TEXT_COLOR = "#1e302c"


def style_title_bar(window):
    if sys.getwindowsversion().build < 22000:
        return
    from System.Windows.Forms import SystemInformation

    if SystemInformation.HighContrast:
        return
    hwnd = wintypes.HWND(window.native.Handle.ToInt64())
    set_attribute = ctypes.windll.dwmapi.DwmSetWindowAttribute
    set_attribute.argtypes = (wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD)
    # DWMWA_CAPTION_COLOR and DWMWA_TEXT_COLOR use COLORREF (0x00BBGGRR).
    for attribute, color in ((35, TOPBAR_COLOR), (36, TITLE_TEXT_COLOR)):
        value = wintypes.DWORD(int.from_bytes(bytes.fromhex(color[1:]), "little"))
        set_attribute(hwnd, attribute, ctypes.byref(value), ctypes.sizeof(value))


def choose_directory(window):
    import webview
    from System import Action

    selected = None

    def show_dialog():
        nonlocal selected
        selected = window.create_file_dialog(webview.FileDialog.FOLDER)

    # The HTTP worker has no Windows message loop. Show the shell dialog on the window thread.
    window.native.Invoke(Action(show_dialog))
    return selected


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
            window = webview.create_window(TITLE, f"http://127.0.0.1:{PORT}/", width=1180, height=820,
                                           min_size=(640, 480), text_select=True, background_color=TOPBAR_COLOR)
            window.events.before_show += style_title_bar
            server.folders.pick = lambda: choose_directory(window)
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
