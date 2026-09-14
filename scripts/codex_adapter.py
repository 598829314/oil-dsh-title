"""通过官方 App Server 协议读取/改名，通过临时 CLI 会话独立命名。"""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time


class BackendError(RuntimeError):
    pass


def find_codex(explicit: str | None = None) -> str:
    if explicit:
        resolved = shutil.which(explicit)
        if resolved:
            return resolved
        raise BackendError("配置的 Codex 可执行文件不存在")
    if sys.platform == "darwin":
        for base in (Path("/Applications"), Path.home() / "Applications"):
            for app in ("ChatGPT.app", "Codex.app"):
                candidate = base / app / "Contents/Resources/codex"
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate)
    path = shutil.which("codex")
    if not path:
        raise BackendError("未找到 Codex；请安装并登录，或配置 codex_bin")
    return path


def worker_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_APP_TOOLS_PIPE_PATH"):
        env.pop(key, None)
    env["OIL_CODEX_TITLE_WORKER"] = "1"
    return env


class CodexBackend:
    """独立 stdio 连接；不会 resume 原会话或向它发送 turn/start。"""
    def __init__(self, binary: str, timeout: float = 15, *, disable_hooks: bool = True):
        self.binary = binary
        self.timeout = timeout
        self.proc = None
        self.messages = queue.Queue()
        self.counter = 0
        self.disable_hooks = disable_hooks

    def __enter__(self):
        self.proc = subprocess.Popen(
            [self.binary, "app-server"] + (["--disable", "hooks"] if self.disable_hooks else []),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            encoding="utf-8", env=worker_env(),
        )
        threading.Thread(target=self._reader, daemon=True).start()
        try:
            self.call("initialize", {
                "clientInfo": {"name": "oil-codex-title", "version": "0.1.0"},
                "capabilities": {"experimentalApi": True},
            })
            self._send({"method": "initialized"})
        except Exception:
            self.__exit__(None, None, None)
            raise
        return self

    def _reader(self):
        try:
            for line in self.proc.stdout:
                self.messages.put(json.loads(line))
        except (ValueError, OSError):
            pass
        finally:
            self.messages.put(None)

    def _send(self, value):
        self.proc.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def call(self, method, params):
        self.counter += 1
        request_id = self.counter
        self._send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                message = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty as exc:
                raise BackendError("App Server 请求超时：" + method) from exc
            if message is None:
                raise BackendError("App Server 连接已关闭")
            if message.get("id") != request_id:
                if time.monotonic() > deadline:
                    raise BackendError("App Server 请求超时：" + method)
                continue
            if "error" in message:
                code = message["error"].get("code")
                raise BackendError(f"App Server {method} 失败（{code}）；请用兼容的桌面版本运行 doctor")
            return message["result"]

    def read(self, thread_id):
        return self.call("thread/read", {"threadId": thread_id, "includeTurns": True})["thread"]

    def rename(self, thread_id, title):
        return self.call("thread/name/set", {"threadId": thread_id, "name": title})

    def __exit__(self, *_):
        if self.proc is None:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=3)
        for stream in (self.proc.stdin, self.proc.stdout):
            if stream:
                stream.close()


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "action": {"type": "string", "enum": ["keep", "rename"]},
        "title": {"type": "string"}, "reason": {"type": "string"},
    },
    "required": ["action", "title", "reason"],
}


def normalize_project_prefix(candidate, context):
    """去掉与外层目录精确等价的重复前缀，不猜项目别名或修改 keep。"""
    hint = re.sub(r"[\W_]+", "", context.get("project_hint", ""))
    if candidate.get("action") != "rename" or not hint or " " not in candidate.get("title", ""):
        return candidate
    emoji, body = candidate["title"].split(" ", 1)
    # 兼容 kite-lms、Kite LMS、KiteLMS，不把 Maple 错当成 MaplePay。
    pattern = r"^" + r"[\s._-]*".join(re.escape(c) for c in hint) + r"\s+(.+)$"
    match = re.match(pattern, body, re.IGNORECASE)
    if not match:
        return candidate
    remaining = match.group(1).strip()
    if len(remaining) < 2 or re.match(r"^(与|和|到|及|→|->|vs\b|to\b)", remaining, re.IGNORECASE):
        return candidate
    return {**candidate, "title": emoji + " " + remaining}


def generate_title(binary, config, context, plugin_root):
    # 只有问候/确认时没有命名证据；确定性保留，避免模型凭空生成“普通讨论”。
    trivial = {"", "你好", "您好", "hi", "hello", "嗨", "谢谢", "好的", "好", "ok", "收到", "继续", "嗯"}
    user_texts = [context.get("original_goal", "")] + [
        message.get("text", "") for turn in context.get("recent_turns", [])
        for message in turn.get("messages", []) if message.get("role") == "user"
    ]
    if all(re.sub(r"[\W_]+", "", text).casefold() in trivial for text in user_texts):
        return {"action": "keep", "title": context.get("current_title", ""),
                "reason": "只有问候或确认，缺少新的命名依据"}, {}
    # 复用当前登录；不复制凭据，不恢复原会话，不保留独立会话记录。
    with tempfile.TemporaryDirectory(prefix="oil-codex-title-") as tmp:
        temp = Path(tmp)
        schema = temp / "schema.json"
        schema.write_text(json.dumps(SCHEMA), encoding="utf-8")
        output = temp / "result.json"
        policy = plugin_root / "prompts/naming.md"
        args = [
            binary, "exec", "--ephemeral", "--ignore-user-config",
            "--skip-git-repo-check", "--sandbox", "read-only", "-C", tmp,
            "--disable", "hooks", "--disable", "shell_tool",
            "--disable", "plugins", "--disable", "apps", "--disable", "multi_agent",
            "-m", config["model"], "-c", 'model_reasoning_effort="low"',
            "-c", "project_doc_max_bytes=0", "-c", "skills.max_context_tokens=1",
            "-c", "agents.enabled=false", "-c", 'web_search="disabled"',
            "-c", "apps._default.enabled=false",
            "-c", "model_instructions_file=" + json.dumps(str(policy)),
            "--output-schema", str(schema), "--output-last-message", str(output),
            "--json", "-",
        ]
        if config.get("service_tier"):
            args[2:2] = ["-c", "service_tier=" + json.dumps(config["service_tier"])]
        try:
            proc = subprocess.run(args, input=json.dumps(context, ensure_ascii=False),
                                  capture_output=True, encoding="utf-8", env=worker_env(),
                                  timeout=config["model_timeout_seconds"])
        except subprocess.TimeoutExpired as exc:
            raise BackendError("独立命名模型超时；原标题保留") from exc
        if proc.returncode or not output.exists():
            raise BackendError("独立命名模型失败；请检查登录、模型配置和 doctor")
        result = json.loads(output.read_text(encoding="utf-8"))
        usage = {}
        for line in proc.stdout.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "turn.completed":
                usage = event.get("usage", {})
            item = event.get("item", {})
            if item.get("type") in {"command_execution", "mcp_tool_call", "web_search"}:
                raise BackendError("命名模型尝试调用工具，本次结果已丢弃")
        return normalize_project_prefix(result, context), usage
