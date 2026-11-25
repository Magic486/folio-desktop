"""Local connection preferences, official account sign-in and provider dispatch."""

import base64
import ctypes
import json
import os
import threading
import time
from ctypes import wintypes
from pathlib import Path
from urllib import error, parse, request

from codex_account import CodexClient, ConnectionErrorUI
from materials import build_input, INSTRUCTIONS, OUTPUT_SCHEMA, VISION_INSTRUCTIONS, VISION_SCHEMA

DEFAULT_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-5.4-mini"


class _Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("ptr", ctypes.c_void_p)]


def protect(data, decrypt=False):
    if not data:
        return b""
    if os.name != "nt":
        raise ConnectionErrorUI("此版本需要 Windows 凭据保护来保存 API 密钥。")
    buffer = ctypes.create_string_buffer(data)
    src = _Blob(len(data), ctypes.cast(buffer, ctypes.c_void_p))
    dest = _Blob()
    crypto = ctypes.windll.crypt32
    fn = crypto.CryptUnprotectData if decrypt else crypto.CryptProtectData
    if not fn(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dest)):
        raise ConnectionErrorUI("无法读取或保存本机加密凭据，请重新输入 API 密钥。")
    try:
        return ctypes.string_at(dest.ptr, dest.size)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(dest.ptr))


def normalize_url(value):
    if not isinstance(value, str) or len(value) > 1200:
        raise ConnectionErrorUI("请填写有效的 API 地址。")
    value = value.strip().rstrip("/").removesuffix("/chat/completions")
    url = parse.urlsplit(value)
    local = url.hostname in ("localhost", "127.0.0.1", "::1")
    if (
        not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or not (url.scheme == "https" or local and url.scheme == "http")
    ):
        raise ConnectionErrorUI("API 地址请使用 HTTPS，本机服务也可以使用 HTTP。")
    return value


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def complete(base, model, key, messages):
    body = json.dumps({"model": model, "messages": messages}, ensure_ascii=False).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    req = request.Request(base + "/chat/completions", data=body, headers=headers, method="POST")
    try:
        with request.build_opener(NoRedirect).open(req, timeout=105) as response:
            payload = json.loads(response.read(2_000_000))
        content = payload["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ConnectionErrorUI("模型没有返回文本，请检查模型名称后重试。")
        return content.strip()
    except error.HTTPError as exc:
        messages = {
            400: "API 未接受请求，请检查模型名称以及模型支持的输入格式。",
            401: "API 密钥无效，请检查后重试。",
            403: "这个密钥没有调用该模型的权限。",
            404: "找不到 API 或模型，请检查 API 地址和模型名称。",
            429: "API 额度不足或请求过于频繁，请稍后重试。",
        }
        raise ConnectionErrorUI(
            messages.get(exc.code, f"API 返回 HTTP {exc.code}，请检查服务地址或稍后重试。")
        ) from exc
    except (error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionErrorUI("无法连接到 API，请检查地址和网络后重试。") from exc
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ConnectionErrorUI("该地址没有返回兼容 Chat Completions 的结果。") from exc


class AIService:
    def __init__(self, root, client=CodexClient):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "settings.json"
        self.config = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}
        self.client = client
        self.lock = threading.RLock()
        self.pending = None
        self.login_error = ""

    def write(self, **changes):
        # All writers hold the same lock. Publish the new in-memory state only after a successful replace.
        updated = {**self.config, **changes, "revision": self.config.get("revision", 0) + 1}
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(updated, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)
        self.config = updated

    def state(self):
        with self.lock:
            c = self.config
            return {
                "mode": c.get("mode", "local"),
                "revision": c.get("revision", 0),
                "apiReady": bool(c.get("apiReady")),
                "materialReview": True,
                "workflowReview": True,
                "imageReading": True,
                "baseUrl": c.get("baseUrl", DEFAULT_URL),
                "model": c.get("model", DEFAULT_MODEL),
                "hasKey": bool(c.get("secret")),
                "account": c.get("account"),
                "loginUrl": self.pending["url"] if self.pending else "",
                "loginError": self.login_error,
            }

    def api_key(self):
        return protect(base64.b64decode(self.config.get("secret", "")), decrypt=True).decode()

    def configure_api(self, data):
        base = normalize_url(data.get("baseUrl", DEFAULT_URL))
        model = str(data.get("model", "")).strip()
        key = str(data.get("key", "")).strip()
        if not model or len(model) > 200 or len(key) > 4096 or any(c in key for c in "\r\n"):
            raise ConnectionErrorUI("请检查模型名称和 API 密钥。")
        with self.lock:
            revision = self.config.get("revision", 0)
            if data.get("revision", revision) != revision:
                raise ConnectionErrorUI("连接设置已更新，请重新打开设置后再试。")
            if not key and self.config.get("baseUrl") == base:
                key = self.api_key()
        if not key and parse.urlsplit(base).hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ConnectionErrorUI("请为这个 API 地址填写密钥。")
        complete(base, model, key, [{"role": "user", "content": "Reply with OK."}])
        secret = base64.b64encode(protect(key.encode())).decode()
        with self.lock:
            if revision != self.config.get("revision", 0):
                raise ConnectionErrorUI("验证期间连接设置已更新，请重新打开设置后再试。")
            self.cancel_login()
            self.write(mode="api", apiReady=True, baseUrl=base, model=model, secret=secret)
            return self.state()

    def cancel_login(self):
        with self.lock:
            if self.pending:
                flow, self.pending = self.pending, None
                try:
                    flow["client"].send(
                        {"id": 0, "method": "account/login/cancel", "params": {"loginId": flow["id"]}}
                    )
                except ConnectionErrorUI:
                    pass
                if flow["client"].process.poll() is None:
                    flow["client"].process.terminate()
            self.login_error = ""
            return self.state()

    def start_login(self):
        with self.lock:
            if self.pending:
                return self.state()
            rpc = self.client(self.root)
            try:
                flow = rpc.call("account/login/start", {"type": "chatgpt"})
                dest = parse.urlsplit(flow["authUrl"])
                if dest.scheme != "https" or dest.hostname not in (
                    "auth.openai.com",
                    "auth0.openai.com",
                    "chatgpt.com",
                ):
                    raise ConnectionErrorUI("Codex 返回的登录地址无效，请更新官方 Codex CLI。")
                attempt = {"id": flow["loginId"], "url": flow["authUrl"], "client": rpc}
            except Exception:
                rpc.close()
                raise
            self.login_error = ""
            self.pending = attempt
            threading.Thread(target=self._wait_for_login, args=(attempt,), daemon=True).start()
            return self.state()

    def _wait_for_login(self, attempt):
        rpc = attempt["client"]
        deadline = time.monotonic() + 300
        try:
            while True:
                msg = rpc.next_event(deadline)
                info = msg.get("params", {})
                if msg.get("method") == "account/login/completed" and info.get("loginId") == attempt["id"]:
                    if not info.get("success"):
                        raise ConnectionErrorUI("登录未完成或已过期，可以重新登录。")
                    break
            account = rpc.account()
            if not account:
                raise ConnectionErrorUI("尚未读取到 ChatGPT 账号，请重新登录。")
            with self.lock:
                if self.pending is attempt:
                    self.write(mode="chatgpt", account={"plan": account.get("planType") or "ChatGPT"})
        except (ConnectionErrorUI, OSError) as exc:
            with self.lock:
                if self.pending is attempt:
                    self.login_error = (
                        str(exc) if isinstance(exc, ConnectionErrorUI) else "登录状态保存失败，请重试。"
                    )
        finally:
            with self.lock:
                if self.pending is attempt:
                    self.pending = None
            rpc.close()

    def change(self, action):
        with self.lock:
            if action == "local":
                self.cancel_login()
                self.write(mode="local")
            elif action == "forget-api":
                self.write(
                    secret="",
                    apiReady=False,
                    mode="local" if self.config.get("mode") == "api" else self.config.get("mode", "local"),
                )
            elif action in ("use-account", "logout"):
                self.cancel_login()
                with self.client(self.root) as rpc:
                    if action == "logout":
                        rpc.call("account/logout")
                        self.write(
                            account=None,
                            mode=(
                                "local"
                                if self.config.get("mode") == "chatgpt"
                                else self.config.get("mode", "local")
                            ),
                        )
                    else:
                        account = rpc.account()
                        if not account:
                            self.write(
                                account=None,
                                mode=(
                                    "local"
                                    if self.config.get("mode") == "chatgpt"
                                    else self.config.get("mode", "local")
                                ),
                            )
                            raise ConnectionErrorUI("登录已失效，请重新连接 ChatGPT。")
                        self.write(mode="chatgpt", account={"plan": account.get("planType") or "ChatGPT"})
            else:
                raise ConnectionErrorUI("未知的连接操作。")
            return self.state()

    def organize(self, data):
        with self.lock:
            state = self.state()
            if (
                state["mode"] != data.get("mode")
                or state["revision"] != data.get("revision")
                or state["mode"] not in ("api", "chatgpt")
            ):
                raise ConnectionErrorUI("AI 连接已变更，请检查设置后重试。")
            key = self.api_key() if state["mode"] == "api" else ""
        prompt, images, notes, coverage = build_input(data)
        vision = data.get("task") == "readImages"
        instructions = VISION_INSTRUCTIONS if vision else INSTRUCTIONS
        if vision and not images:
            raise ConnectionErrorUI("本轮没有成功读取图片，请重新选择。")
        if state["mode"] == "api":
            user = [{"type": "text", "text": prompt}]
            user.extend({"type": "image_url", "image_url": {"url": image}} for image in images)
            answer = complete(
                state["baseUrl"],
                state["model"],
                key,
                [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": user if images else prompt},
                ],
            )
        else:
            with self.client(self.root) as rpc:
                answer = rpc.organize(instructions, prompt, images, VISION_SCHEMA if vision else OUTPUT_SCHEMA)
        try:
            raw = answer.strip()
            if raw.startswith("```") and raw.endswith("```"):
                raw = "\n".join(raw.splitlines()[1:-1])
            result = json.loads(raw)
            if vision:
                if not isinstance(result.get("readings"), list):
                    raise ValueError()
                return {"readings": [r for r in result["readings"] if isinstance(r, dict) and isinstance(r.get("id"), str) and r["id"] in coverage][:6]}
            if (
                not isinstance(result.get("reply"), str)
                or not result["reply"].strip()
                or not isinstance(result.get("updates"), list)
            ):
                raise ValueError()
        except (ValueError, AttributeError, TypeError) as exc:
            raise ConnectionErrorUI("模型回复的格式无法写入草稿。材料已保留，可以重试。") from exc
        return {
            "reply": result["reply"][:8000],
            "reviewReason": result["reviewReason"].strip()[:240] if isinstance(result.get("reviewReason"), str) else "",
            "updates": result["updates"][:16],
            "fileReviews": result.get("fileReviews", []) if isinstance(result.get("fileReviews"), list) else [],
            "coverage": coverage,
            "clips": result["clips"][:4] if isinstance(result.get("clips"), list) else [],
            "notes": notes,
            "mode": state["mode"],
        }
