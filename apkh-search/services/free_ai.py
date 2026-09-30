"""
The free built-in AI: open-source models the host runs itself, used by everyone
who hasn't added a key of their own. No per-user quota; the host's server is
the only limit.

Defaults to Ollama on the same machine (Qwen3.5 4B for chat, Qwen3-Embedding
0.6B for embeddings), but any OpenAI-compatible server works (llama.cpp, vLLM,
a hosted endpoint): only the env variables below change.

The API sends the model id "free"; the actual models are chosen here.
"""

import logging
import os

logger = logging.getLogger(__name__)

FREE_MODEL_ID = "free"

UNAVAILABLE_MESSAGE = (
    "The free AI model isn't available right now. Try again in a moment, "
    "or add your own AI key in Profile."
)


def is_free_model(model: str) -> bool:
    return model.strip().lower() == FREE_MODEL_ID


def base_url() -> str:
    return os.getenv("FREE_AI_BASE_URL", "http://localhost:11434/v1").strip().rstrip("/")


def api_key() -> str:
    # Ollama ignores it, but the OpenAI client requires one.
    return os.getenv("FREE_AI_API_KEY", "").strip() or "free"


def chat_model() -> str:
    return os.getenv("FREE_AI_CHAT_MODEL", "qwen3.5:4b").strip()


def embedding_model() -> str:
    """The server's name for Qwen3-Embedding-0.6B (vectors are labelled with that model)."""
    return os.getenv("FREE_AI_EMBEDDING_MODEL", "qwen3-embedding:0.6b").strip()


def reads_images() -> bool:
    """Whether the chat model takes images (Qwen3.5 does); "off" for a text-only model."""
    return os.getenv("FREE_AI_VISION", "on").strip().lower() != "off"


def log_failure(what: str, exc: Exception) -> None:
    """Users get UNAVAILABLE_MESSAGE; the host gets the details in the log."""
    logger.error(
        "Free AI %s failed (%s at %s): %s. Is the server running and the model pulled?",
        what, chat_model() if what != "embedding" else embedding_model(), base_url(), exc,
    )
