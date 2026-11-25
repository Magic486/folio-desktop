"""The official Codex JSON-RPC client for Folio's own ChatGPT login."""

import json
import os
import queue
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path


class ConnectionErrorUI(Exception):
    """A short message suitable for showing in the settings or conversation."""


def codex_command():
    npm = shutil.which("codex.cmd")
    if npm:
        package = Path(npm).parent / "node_modules" / "@openai" / "codex"
        binaries = sorted(package.glob("node_modules/@openai/*/vendor/*/bin/codex.exe"))
        if binaries:
            return [str(binaries[0])]
        if (package / "bin/codex.js").is_file() and shutil.which("node"):
            return [shutil.which("node"), str(package / "bin/codex.js")]
    binary = shutil.which("codex.exe") or shutil.which("codex")
    if not binary:
        raise ConnectionErrorUI("未找到本机 Codex。安装官方 Codex CLI 后即可登录 ChatGPT。")
    return [binary]


def rpc_error(error):
    raw = str(error).lower()
    if any(s in raw for s in ("rate limit", "usage limit", "quota", "429")):
        return "当前账号的使用额度或频率已达上限，请稍后重试。"
    if any(s in raw for s in ("401", "unauthorized", "not authenticated", "login required")):
        return "ChatGPT 授权已失效，请到设置重新登录。"
    if any(s in raw for s in ("403", "permission", "not available for")):
        return "这个账号暂时没有使用权限，请检查套餐或工作区权限。"
    return "Codex 未能完成请求，请检查网络或重新登录后再试。"


class CodexClient:
    def __init__(self, root):
        auth_dir = root / "codex-account"
        self.work = root / "empty-workspace"
        auth_dir.mkdir(parents=True, exist_ok=True)
        self.work.mkdir(parents=True, exist_ok=True)
        # Use the CLI's own auth store for this app, independent of the desktop client's login.
        env = {
            k: v
            for k, v in os.environ.items()
            if not k.upper().startswith(("CODEX_", "OPENAI_", "CHATGPT_"))
        }
        env["CODEX_HOME"] = str(auth_dir)
        args = codex_command() + [
            "app-server",
            "--listen",
            "stdio://",
            "-c",
            'web_search="disabled"',
            "-c",
            'cli_auth_credentials_store="auto"',
        ]
        for feature in (
            "shell_tool",
            "unified_exec",
            "apps",
            "plugins",
            "multi_agent",
            "computer_use",
            "browser_use",
            "in_app_browser",
            "code_mode",
            "image_generation",
        ):
            args.extend(["--disable", feature])
        try:
            self.process = subprocess.Popen(
                args,
                cwd=self.work,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as exc:
            raise ConnectionErrorUI("无法启动本机 Codex，请检查 Codex CLI 安装。") from exc
        self.inbox = queue.Queue()
        self.events = deque()
        self.sequence = 0
        threading.Thread(target=self._read, daemon=True).start()
        try:
            self.call(
                "initialize", {"clientInfo": {"name": "folio", "title": "拾页 Folio", "version": "1.0"}}
            )
            self.send({"method": "initialized"})
        except Exception:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                self.inbox.put(json.loads(line))
        except (ValueError, OSError):
            pass
        finally:
            self.inbox.put(None)

    def send(self, obj):
        try:
            self.process.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise ConnectionErrorUI("与本机 Codex 的连接已关闭，请重试。") from exc

    def receive(self, deadline):
        while True:
            try:
                msg = self.inbox.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty as exc:
                raise ConnectionErrorUI("等待 Codex 响应超时，请重试。") from exc
            if msg is None:
                raise ConnectionErrorUI("本机 Codex 已退出，请重试。")
            if "method" in msg and "id" in msg:
                self.send(
                    {"id": msg["id"], "error": {"code": -32601, "message": "No host tools available"}}
                )
                continue
            return msg

    def call(self, method, params=None, timeout=25):
        self.sequence += 1
        message = {"id": self.sequence, "method": method}
        if params is not None:
            message["params"] = params
        self.send(message)
        deadline = time.monotonic() + timeout
        while True:
            msg = self.receive(deadline)
            if msg.get("id") == self.sequence:
                if "error" in msg:
                    raise ConnectionErrorUI(rpc_error(msg["error"]))
                return msg["result"]
            if msg.get("method") in ("account/login/completed", "item/completed", "turn/completed"):
                self.events.append(msg)

    def next_event(self, deadline):
        return self.events.popleft() if self.events else self.receive(deadline)

    def account(self):
        info = self.call("account/read", {"refreshToken": False}).get("account")
        return info if info and info.get("type") == "chatgpt" else None

    def organize(self, instructions, prompt, images, schema):
        if not self.account():
            raise ConnectionErrorUI("请先在设置中登录 ChatGPT。")
        thread = self.call(
            "thread/start",
            {
                "cwd": str(self.work),
                "ephemeral": True,
                "sandbox": "read-only",
                "approvalPolicy": "never",
                "modelProvider": "openai",
                "baseInstructions": instructions,
            },
        )
        tid = thread["thread"]["id"]
        inputs = [{"type": "text", "text": prompt}]
        inputs.extend({"type": "image", "url": image} for image in images)
        turn = self.call("turn/start", {"threadId": tid, "input": inputs, "outputSchema": schema})
        turn_id = turn["turn"]["id"]
        deadline = time.monotonic() + 155
        answer = ""
        while True:
            msg = self.next_event(deadline)
            params = msg.get("params") or {}
            if params.get("threadId") != tid:
                continue
            if msg.get("method") == "item/completed" and params.get("turnId") == turn_id:
                item = params.get("item") or {}
                if item.get("type") == "agentMessage":
                    answer = item.get("text", "")
            if msg.get("method") == "turn/completed" and params["turn"]["id"] == turn_id:
                done = params["turn"]
                if done.get("status") != "completed":
                    raise ConnectionErrorUI(rpc_error(done.get("error")))
                return answer

    def close(self):
        try:
            self.process.stdin.close()
            self.process.wait(timeout=2)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait(timeout=4)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
