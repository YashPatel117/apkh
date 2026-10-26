"""
Claude through the Claude Code CLI installed on this machine.

Model ids are "claude-code:<model>" (an alias such as "sonnet", or a full model
name). No API key is needed: the CLI uses its own login (`claude` → /login, a
Claude subscription or Console account). A token from `claude setup-token`
(or an Anthropic API key) can be given as the key instead; it is passed to the
CLI for that call only.

Every call runs `claude -p` once, with no tools, MCP servers, settings or
session history, in an empty working folder. The subprocess runs in a thread,
so this works whatever event loop uvicorn picked (the Windows selector loop
can't start subprocesses).

Env: CLAUDE_CODE=off turns it off; CLAUDE_CODE_PATH points at the CLI when
it isn't on PATH; CLAUDE_CODE_SLOTS (default 2) caps calls at once;
CLAUDE_CODE_TIMEOUT (seconds, default 300) ends a stuck call.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

logger = logging.getLogger(__name__)

MODEL_PREFIX = "claude-code"

# The CLI resolves these aliases to the newest model of each family.
MODELS = [
    {"id": "claude-code:sonnet", "label": "Claude Sonnet (latest) · balanced"},
    {"id": "claude-code:opus", "label": "Claude Opus (latest) · most capable"},
    {"id": "claude-code:haiku", "label": "Claude Haiku (latest) · fastest"},
]
DEFAULT_MODEL = MODELS[0]["id"]

# An alias or full model name; never something the CLI could read as a flag.
_MODEL_NAME = re.compile(r"^[a-z0-9][a-z0-9.\-\[\]]*$")

NOT_INSTALLED_MESSAGE = (
    "Claude Code isn't installed on the server. Install it (https://claude.com/claude-code), "
    "then run `claude` once to log in."
)
NOT_LOGGED_IN_MESSAGE = (
    "Claude Code on the server isn't logged in. Run `claude` there and log in, "
    "or paste a token from `claude setup-token`."
)
DISABLED_MESSAGE = "Claude Code is turned off on this server."

_STATUS_TIMEOUT = 20.0
_STDERR_TAIL = 2000


class ClaudeCodeError(Exception):
    """The CLI is missing, not logged in, or the call failed; the message is safe to show."""


def is_claude_code_model(model: str) -> bool:
    normalized = model.strip().lower()
    return normalized == MODEL_PREFIX or normalized.startswith(MODEL_PREFIX + ":")


def enabled() -> bool:
    return os.getenv("CLAUDE_CODE", "on").strip().lower() != "off"


def cli_path() -> str | None:
    configured = os.getenv("CLAUDE_CODE_PATH", "").strip()
    if configured:
        return configured if os.path.isfile(configured) else shutil.which(configured)
    return shutil.which("claude")


def _float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def _cli_model(model: str) -> str:
    name = model.strip().lower().removeprefix(MODEL_PREFIX).removeprefix(":") or "sonnet"
    if not _MODEL_NAME.match(name):
        raise ClaudeCodeError(f"Unknown Claude Code model '{model}'.")
    return name


def _env(token: str) -> dict[str, str]:
    """The CLI's environment: its own login, or the given token for this call."""
    env = dict(os.environ)
    token = token.strip()
    if token.startswith("sk-ant-api"):
        env["ANTHROPIC_API_KEY"] = token
        env.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
    elif token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = token
        env.pop("ANTHROPIC_API_KEY", None)
    return env


_workdir: str | None = None


def _empty_workdir() -> str:
    """A folder with nothing in it, so no CLAUDE.md or project settings are picked up."""
    global _workdir
    if _workdir is None or not os.path.isdir(_workdir):
        _workdir = tempfile.mkdtemp(prefix="apkh-claude-code-")
    return _workdir


_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _check_available() -> str:
    if not enabled():
        raise ClaudeCodeError(DISABLED_MESSAGE)
    path = cli_path()
    if not path:
        raise ClaudeCodeError(NOT_INSTALLED_MESSAGE)
    return path


# ── Status and models ───────────────────────────────────────────────────────


def _logged_in(path: str) -> bool:
    try:
        done = subprocess.run(
            [path, "auth", "status"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=_STATUS_TIMEOUT, cwd=_empty_workdir(), creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("claude auth status failed: %s", exc)
        raise ClaudeCodeError("Claude Code on the server didn't respond. Try again in a moment.") from exc
    try:
        return bool(json.loads(done.stdout).get("loggedIn"))
    except (ValueError, AttributeError):
        # Older CLIs print text; a failed check shows up on the first call instead.
        return done.returncode == 0


async def list_models(token: str = "") -> list[dict[str, str]]:
    """The models to offer; raises ClaudeCodeError when Claude Code can't be used here."""
    path = _check_available()
    if not token.strip() and not await asyncio.to_thread(_logged_in, path):
        raise ClaudeCodeError(NOT_LOGGED_IN_MESSAGE)
    return MODELS


# ── Calls ───────────────────────────────────────────────────────────────────


def _content_blocks(content: Any) -> list[dict[str, Any]]:
    """LangChain message content as Anthropic content blocks (text and base64 images)."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    blocks: list[dict[str, Any]] = []
    for item in content or []:
        if isinstance(item, str):
            blocks.append({"type": "text", "text": item})
        elif isinstance(item, dict) and item.get("type") == "text":
            blocks.append({"type": "text", "text": str(item.get("text", ""))})
        elif isinstance(item, dict) and item.get("type") == "image_url":
            url = str((item.get("image_url") or {}).get("url", ""))
            match = re.match(r"data:([^;]+);base64,(.*)$", url, re.S)
            if match:
                blocks.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": match.group(1), "data": match.group(2)},
                })
    return blocks


def _prompt(messages: list[BaseMessage]) -> tuple[str, list[dict[str, Any]]]:
    """
    The system prompt, and one user turn: the CLI starts a fresh conversation
    on every call, so earlier turns are written out as a transcript.
    """
    system = "\n\n".join(_text(m.content) for m in messages if isinstance(m, SystemMessage))
    turns = [m for m in messages if not isinstance(m, SystemMessage)]
    if not turns:
        return system, []
    *earlier, last = turns
    blocks = _content_blocks(last.content)
    if earlier:
        transcript = "\n\n".join(
            f"{'Assistant' if isinstance(m, AIMessage) else 'User'}: {_text(m.content)}" for m in earlier
        )
        blocks.insert(0, {
            "type": "text",
            "text": f"Conversation so far:\n\n{transcript}\n\n---\n\nThe user's new message:",
        })
    return system, blocks


def _text(content: Any) -> str:
    return "\n".join(b["text"] for b in _content_blocks(content) if b["type"] == "text")


class _Run:
    """One `claude -p` process, read event by event; kill() ends it early."""

    def __init__(self, model: str, token: str, messages: list[BaseMessage]):
        self._path = _check_available()
        self._model = _cli_model(model)
        self._token = token
        self._system, self._blocks = _prompt(messages)
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._killed = False

    def events(self) -> Iterator[dict[str, Any]]:
        workdir = _empty_workdir()
        # Long prompts (notes as context) don't fit on a Windows command line.
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", suffix=".txt", dir=workdir, delete=False
        ) as system_file:
            system_file.write(self._system or "You are a helpful assistant.")
        args = [
            self._path, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--model", self._model,
            "--system-prompt-file", system_file.name,
            "--tools", "",
            "--strict-mcp-config",
            "--setting-sources", "",
            "--disable-slash-commands",
            "--no-session-persistence",
        ]
        timer: threading.Timer | None = None
        try:
            with self._lock:
                # kill() before the start means the caller already gave up.
                if self._killed:
                    return
                self._proc = subprocess.Popen(
                    args,
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, encoding="utf-8", errors="replace",
                    cwd=workdir, env=_env(self._token), creationflags=_NO_WINDOW,
                )
            proc = self._proc
            timer = threading.Timer(_float_env("CLAUDE_CODE_TIMEOUT", 300.0), self.kill)
            timer.daemon = True
            timer.start()
            stderr: list[str] = []
            reader = threading.Thread(target=lambda: stderr.append(proc.stderr.read()), daemon=True)
            reader.start()

            message = {"type": "user", "message": {"role": "user", "content": self._blocks}}
            proc.stdin.write(json.dumps(message) + "\n")
            proc.stdin.close()

            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict):
                    yield event
            proc.wait()
            reader.join(timeout=5)
            if self._killed:
                raise ClaudeCodeError("Claude Code took too long to answer.")
            if proc.returncode:
                tail = "".join(stderr).strip()[-_STDERR_TAIL:]
                logger.error("claude exited with %s: %s", proc.returncode, tail)
                raise ClaudeCodeError(_error_message(tail) or "Claude Code failed to answer.")
        finally:
            if timer:
                timer.cancel()
            self.kill()
            try:
                os.unlink(system_file.name)
            except OSError:
                pass

    def kill(self) -> None:
        """Ends the call if it is still running (or keeps it from starting)."""
        with self._lock:
            if self._proc is None:
                self._killed = True
            elif self._proc.poll() is None:
                self._killed = True
                self._proc.kill()


def _error_message(text: str) -> str:
    lowered = text.lower()
    if "not logged in" in lowered or "/login" in lowered or "invalid api key" in lowered or "oauth" in lowered:
        return NOT_LOGGED_IN_MESSAGE
    line = next((part.strip() for part in text.splitlines() if part.strip()), "")
    return line[:300]


def _usage(event: dict[str, Any]) -> dict[str, int] | None:
    usage = event.get("usage")
    if not isinstance(usage, dict):
        return None
    prompt = sum(
        int(usage.get(key) or 0)
        for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    )
    output = int(usage.get("output_tokens") or 0)
    return {"input_tokens": prompt, "output_tokens": output, "total_tokens": prompt + output}


def _pieces(events: Iterator[dict[str, Any]]) -> Iterator[tuple[str, dict[str, int] | None]]:
    """(text, None) for each piece of the answer, then ("", usage) once at the end."""
    for event in events:
        kind = event.get("type")
        if kind == "stream_event":
            inner = event.get("event") or {}
            delta = inner.get("delta") or {}
            if inner.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                text = delta.get("text") or ""
                if text:
                    yield text, None
        elif kind == "result":
            if event.get("is_error"):
                raise ClaudeCodeError(_error_message(str(event.get("result") or "")) or "Claude Code failed to answer.")
            yield "", _usage(event)
            return


# At most this many CLI processes at once; each is a full Node process.
_slots: asyncio.Semaphore | None = None


def _gate() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(max(1, int(_float_env("CLAUDE_CODE_SLOTS", 2))))
    return _slots


_DONE = object()


async def _apieces(run: _Run) -> AsyncIterator[tuple[str, dict[str, int] | None]]:
    """_pieces from a worker thread, killing the process if the caller stops early."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def work() -> None:
        try:
            for piece in _pieces(run.events()):
                loop.call_soon_threadsafe(queue.put_nowait, piece)
        except BaseException as exc:  # handed to the caller
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, _DONE)

    async with _gate():
        worker = asyncio.ensure_future(asyncio.to_thread(work))
        try:
            while True:
                item = await queue.get()
                if item is _DONE:
                    break
                if isinstance(item, BaseException):
                    raise item
                yield item
        finally:
            run.kill()
            await asyncio.shield(worker)


class ChatClaudeCode(BaseChatModel):
    """A LangChain chat model that answers through the local Claude Code CLI."""

    model: str = DEFAULT_MODEL
    token: str = ""

    @property
    def _llm_type(self) -> str:
        return "claude-code"

    def _result(self, text: str, usage: dict[str, int] | None) -> ChatResult:
        message = AIMessage(content=text, usage_metadata=usage) if usage else AIMessage(content=text)
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _generate(
        self, messages: list[BaseMessage], stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None, **kwargs: Any,
    ) -> ChatResult:
        parts: list[str] = []
        usage = None
        for text, piece_usage in _pieces(_Run(self.model, self.token, messages).events()):
            parts.append(text)
            usage = piece_usage or usage
        return self._result("".join(parts), usage)

    async def _agenerate(
        self, messages: list[BaseMessage], stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any,
    ) -> ChatResult:
        parts: list[str] = []
        usage = None
        async for text, piece_usage in _apieces(_Run(self.model, self.token, messages)):
            parts.append(text)
            usage = piece_usage or usage
        return self._result("".join(parts), usage)

    async def _astream(
        self, messages: list[BaseMessage], stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None, **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        async for text, usage in _apieces(_Run(self.model, self.token, messages)):
            chunk = AIMessageChunk(content=text, usage_metadata=usage) if usage else AIMessageChunk(content=text)
            if run_manager and text:
                await run_manager.on_llm_new_token(text)
            yield ChatGenerationChunk(message=chunk)
