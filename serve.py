"""Serve the local Folio workspace and its AI settings on the same origin."""

import argparse
import json
import os
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from codex_account import ConnectionErrorUI
from folio_ai import AIService

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/",
    "/index.html",
    "/styles.css",
    "/app.js",
    "/folders.js",
    "/views.js",
    "/workspace.js",
    "/transfer.js",
    "/evidence.js",
    "/assets/jszip.min.js",
    "/assets/jszip-LICENSE.md",
    "/ai.js",
    "/assets/folio.svg",
}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header("X-Folio-Service", "local" if self.server.ai else "static")
        if self.companion_origin():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Expose-Headers", "X-Folio-Service")
            self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_reply(self, value, status=200):
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def allowed_host(self):
        port = self.server.server_port
        return self.headers.get("Host", "") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def companion_origin(self):
        return self.server.server_port == 52844 and self.headers.get("Origin") in (
            "http://127.0.0.1:52843", "http://localhost:52843")

    def do_OPTIONS(self):
        if not self.allowed_host() or not self.companion_origin() or not self.path.startswith("/api/"):
            return self.send_error(403)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Folio-Client")
        self.end_headers()

    def local_api(self):
        origin = self.headers.get("Origin")
        return (
            self.allowed_host()
            and self.headers.get("X-Folio-Client") == "workspace"
            and self.server.ai is not None
            and (origin is None or origin == "http://" + self.headers["Host"] or self.companion_origin())
        )

    def do_GET(self):
        path = urlsplit(self.path).path
        if not self.allowed_host():
            return self.send_error(403)
        if path == "/api/settings":
            if not self.local_api():
                return self.json_reply({"error": "请在本机拾页中打开设置。"}, 403)
            return self.json_reply({**self.server.ai.state(), "desktop": self.server.desktop})
        if path not in STATIC:
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        if not self.allowed_host() or urlsplit(self.path).path not in STATIC:
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        if not self.local_api() or self.headers.get_content_type() != "application/json":
            return self.json_reply({"error": "请从本机拾页发起请求。"}, 403)
        ai = self.server.ai
        path = urlsplit(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 17_000_000:
                return self.json_reply({"error": "本次材料较大，请分批发送。"}, 413)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError()
            if path.startswith("/api/folders/") and self.server.desktop:
                folders = self.server.folders
                if path == "/api/folders/select":
                    result = {"folder": folders.select()}
                elif path == "/api/folders/start":
                    result = folders.start(data)
                elif path == "/api/folders/status":
                    result = folders.status(data["root"])
                elif path == "/api/folders/proof":
                    body = folders.artifact(data)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                else:
                    return self.json_reply({"error": "接口不存在。"}, 404)
            elif path == "/api/api-key":
                result = ai.configure_api(data)
            elif path == "/api/account/login":
                result = ai.start_login()
                if self.server.desktop and result.get("loginUrl"):
                    webbrowser.open(result["loginUrl"])
            elif path == "/api/account/cancel":
                result = ai.cancel_login()
            elif path == "/api/connection":
                result = ai.change(data.get("action"))
            elif path == "/api/organize":
                result = ai.organize(data)
            else:
                return self.json_reply({"error": "接口不存在。"}, 404)
            self.json_reply(result)
        except ConnectionErrorUI as exc:
            self.json_reply({"error": str(exc)}, 422)
        except (ValueError, UnicodeError, TypeError, KeyError):
            self.json_reply({"error": "提交的内容格式有误，请检查后重试。"}, 400)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            self.json_reply({"error": "本机服务未能完成操作，请重试。"}, 500)


def create_server(port, root, desktop=False):
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    server.ai = AIService(root) if root is not None else None
    server.desktop = desktop
    if desktop:
        from folder_scan import DirectoryScan
        server.folders = DirectoryScan(Path(root).parent / "directories", server.ai)
    return server


def existing_service(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/", timeout=1.5) as response:
            if response.headers.get("X-Folio-Service") == "local":
                return "local"
            html = response.read(8000)
            if b'id="sidebar-toggle"' in html and b'src="ai.js' in html:
                return "static"
            return "other"
    except OSError:
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=52843)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}/#work"
    root = Path(os.getenv("LOCALAPPDATA") or Path.home()) / "FolioExperience"
    port = args.port
    existing = existing_service(port)
    if port == 52843:
        companion = existing_service(52844)
        if existing == "static":
            port, existing = 52844, companion
        elif not existing and companion == "local":
            root = None
    if existing == "local":
        if args.open:
            webbrowser.open(url)
        sys.exit(0)
    if existing:
        raise SystemExit("该端口已被其他服务占用，无法启动拾页。")
    try:
        server = create_server(port, root)
    except OSError:
        raise SystemExit("该端口已被占用，无法启动拾页。")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
