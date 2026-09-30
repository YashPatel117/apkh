"""
The built-in AI: open-source models the host runs itself, used by everyone
who hasn't activated a key of their own. How much of it a user gets per
session is decided by their plan in the API; here requests are served in
priority order.

Defaults to Ollama on the same machine (Qwen3.5 4B for chat, Qwen3-Embedding
0.6B for embeddings), but any OpenAI-compatible server works (llama.cpp, vLLM,
a hosted endpoint): only the env variables below change.

The API sends the model id "builtin"; the actual models are chosen here.
"""

import asyncio
import heapq
import itertools
import logging
import os
import time
from contextlib import asynccontextmanager
from contextvars import ContextVar

logger = logging.getLogger(__name__)

BUILTIN_MODEL_ID = "builtin"

UNAVAILABLE_MESSAGE = (
    "The built-in AI isn't available right now. Try again in a moment, "
    "or add your own AI key in Profile."
)

# Lower runs sooner. The API sends it per request (X-AI-Priority): Pro questions
# 0, Free questions 1, Pro indexing 2, Free indexing 3.
PRIORITY_HEADER = "x-ai-priority"
DEFAULT_PRIORITY = 1
request_priority: ContextVar[int] = ContextVar("request_priority", default=DEFAULT_PRIORITY)

# Waits longer than this are logged, so the host can see when the server is busy.
_SLOW_WAIT_SECONDS = 5.0


def is_builtin_model(model: str) -> bool:
    return model.strip().lower() == BUILTIN_MODEL_ID


def base_url() -> str:
    return os.getenv("BUILTIN_AI_BASE_URL", "http://localhost:11434/v1").strip().rstrip("/")


def api_key() -> str:
    # Ollama ignores it, but the OpenAI client requires one.
    return os.getenv("BUILTIN_AI_API_KEY", "").strip() or "builtin"


def chat_model() -> str:
    return os.getenv("BUILTIN_AI_CHAT_MODEL", "qwen3.5:4b").strip()


def embedding_model() -> str:
    """The server's name for Qwen3-Embedding-0.6B (vectors are labelled with that model)."""
    return os.getenv("BUILTIN_AI_EMBEDDING_MODEL", "qwen3-embedding:0.6b").strip()


def reads_images() -> bool:
    """Whether the chat model takes images (Qwen3.5 does); "off" for a text-only model."""
    return os.getenv("BUILTIN_AI_VISION", "on").strip().lower() != "off"


def log_failure(what: str, exc: Exception) -> None:
    """Users get UNAVAILABLE_MESSAGE; the host gets the details in the log."""
    logger.error(
        "Built-in AI %s failed (%s at %s): %s. Is the server running and the model pulled?",
        what, embedding_model() if what == "embedding" else chat_model(), base_url(), exc,
    )


def parse_priority(value: str | None) -> int:
    try:
        return max(0, int(value)) if value is not None else DEFAULT_PRIORITY
    except ValueError:
        return DEFAULT_PRIORITY


class PriorityGate:
    """
    At most `slots` calls run at once; the others wait, lowest priority number
    first, then in arrival order. A CPU serves one call at a time well, and
    Ollama's own queue is first come, first served.
    """

    def __init__(self, name: str, slots: int):
        self._name = name
        self._slots = max(1, slots)
        self._busy = 0
        self._waiting: list[tuple[int, int, asyncio.Future]] = []
        self._order = itertools.count()

    @asynccontextmanager
    async def slot(self):
        priority = request_priority.get()
        started = time.monotonic()
        if self._busy < self._slots and not self._waiting:
            self._busy += 1
        else:
            turn = asyncio.get_running_loop().create_future()
            heapq.heappush(self._waiting, (priority, next(self._order), turn))
            try:
                await turn
            except asyncio.CancelledError:
                # The slot may have been handed over just before the cancel.
                if turn.done() and not turn.cancelled():
                    self._release()
                raise
        waited = time.monotonic() - started
        if waited > _SLOW_WAIT_SECONDS:
            logger.info(
                "Built-in AI %s: waited %.0fs for a slot (priority %d, %d still waiting)",
                self._name, waited, priority, len(self._waiting),
            )
        try:
            yield
        finally:
            self._release()

    def _release(self) -> None:
        # Hand the slot straight to the next waiter; cancelled waiters are skipped.
        while self._waiting:
            _, _, turn = heapq.heappop(self._waiting)
            if not turn.done():
                turn.set_result(None)
                return
        self._busy -= 1


def _slots(name: str) -> int:
    try:
        return int(os.getenv(name, "1"))
    except ValueError:
        return 1


# One gate per model: Ollama runs the two models side by side.
chat_gate = PriorityGate("chat", _slots("BUILTIN_AI_CHAT_SLOTS"))
embedding_gate = PriorityGate("embedding", _slots("BUILTIN_AI_EMBEDDING_SLOTS"))
