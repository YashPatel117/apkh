"""
Embeddings with the user's own provider credentials.

The API chooses the embedding model and dimensions (one "embedding space" per
provider) and stores that space next to every vector, so vectors from different
spaces are never compared. Gemini and OpenAI have embedding models; Anthropic
does not, so Claude users get keyword search instead. OpenRouter keys embed with
OpenAI's text-embedding-3-small through OpenRouter: the same model, so the same
space as OpenAI keys. It is paid; a key without credit gets a 402, and the API
falls back to keyword search.

The free built-in AI embeds with Qwen3-Embedding-0.6B on the host's own server.
Its 1024-dimension vectors are zero-padded to 1536 so they fit the same vector
index as the other spaces; padding changes neither the norm nor any cosine
similarity. Queries carry the model's retrieval instruction, documents don't.

Vectors are L2-normalised: cosine similarity is then a plain dot product, and
Gemini's reduced-size outputs (which the API returns unnormalised) score
correctly.
"""

import logging
import math
from dataclasses import dataclass
from typing import Any

import tiktoken
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_openai import OpenAIEmbeddings

from services import free_ai
from services.llm import OPENROUTER_BASE_URL, OPENROUTER_HEADERS, detect_provider, provider_error_message

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODELS = {
    "free": "qwen3-embedding-0.6b",
    "gemini": "gemini-embedding-001",
    "openai": "text-embedding-3-small",
    "openrouter": "text-embedding-3-small",
}
# OpenRouter's id for the same model
_OPENROUTER_EMBEDDING_MODELS = {"text-embedding-3-small": "openai/text-embedding-3-small"}
DEFAULT_DIMENSIONS = 1536
EMBED_BATCH_SIZE = 100

# Only models whose output the API knows how to label as a space.
_SUPPORTED_DIMENSIONS = {
    "gemini-embedding-001": {768, 1536, 3072},
    "text-embedding-3-small": {512, 1536},
    "qwen3-embedding-0.6b": {1536},
}

# Qwen3-Embedding ranks better when queries (not documents) state the task.
_FREE_QUERY_INSTRUCTION = (
    "Instruct: Given a question, retrieve passages from the user's notes that answer it\nQuery:"
)

_token_encoder = tiktoken.get_encoding("cl100k_base")


@dataclass(frozen=True)
class EmbeddingSpace:
    provider: str
    model: str
    dimensions: int


class EmbeddingError(Exception):
    """A provider failure, with the HTTP status the caller should see."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def resolve_space(
    chat_model: str,
    embedding_model: str | None = None,
    dimensions: int | None = None,
) -> EmbeddingSpace:
    """The embedding space for a user's chat model. Raises EmbeddingError(400) if it has none."""
    try:
        provider = detect_provider(chat_model.strip())
    except ValueError as exc:
        raise EmbeddingError(str(exc), 400) from exc

    default_model = DEFAULT_EMBEDDING_MODELS.get(provider)
    if default_model is None:
        raise EmbeddingError(
            "Anthropic models are not supported for semantic search embeddings. "
            "Notes are matched by keyword instead.",
            400,
        )

    model = embedding_model or default_model
    size = dimensions or DEFAULT_DIMENSIONS
    if model != default_model or size not in _SUPPORTED_DIMENSIONS[model]:
        raise EmbeddingError(f"Unsupported embedding space {model}@{size} for {provider}.", 400)
    return EmbeddingSpace(provider=provider, model=model, dimensions=size)


def estimate_tokens(texts: list[str]) -> int:
    """Embedding APIs bill input tokens; langchain doesn't report them, so count locally."""
    return sum(len(_token_encoder.encode(text or "")) for text in texts)


async def embed_documents(
    texts: list[str],
    api_key: str,
    space: EmbeddingSpace,
) -> list[list[float]]:
    """Embed passages for storage (Gemini: RETRIEVAL_DOCUMENT task type)."""
    if not texts:
        return []
    embedder = _build_embedder((api_key or "").strip(), space)
    normalized_texts = [text if text.strip() else " " for text in texts]
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(normalized_texts), EMBED_BATCH_SIZE):
            batch = normalized_texts[start:start + EMBED_BATCH_SIZE]
            if space.provider == "gemini":
                batch_vectors = await embedder.aembed_documents(
                    batch,
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=space.dimensions,
                )
            else:
                batch_vectors = await embedder.aembed_documents(batch)
            vectors.extend(_fit(_normalize(vector), space) for vector in batch_vectors)
    except Exception as exc:  # pragma: no cover - provider-specific behavior
        raise _to_embedding_error(space, exc) from exc

    return vectors


async def embed_query(text: str, api_key: str, space: EmbeddingSpace) -> list[float]:
    """Embed a search query (Gemini: RETRIEVAL_QUERY task type, which pairs with documents)."""
    embedder = _build_embedder((api_key or "").strip(), space)
    try:
        if space.provider == "gemini":
            vector = await embedder.aembed_query(
                text,
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=space.dimensions,
            )
        elif space.provider == "free":
            vector = await embedder.aembed_query(f"{_FREE_QUERY_INSTRUCTION}{text}")
        else:
            vector = await embedder.aembed_query(text)
    except Exception as exc:  # pragma: no cover - provider-specific behavior
        raise _to_embedding_error(space, exc) from exc
    return _fit(_normalize(vector), space)


def _build_embedder(api_key: str, space: EmbeddingSpace) -> Any:
    if space.provider == "free":
        return OpenAIEmbeddings(
            model=free_ai.embedding_model(),
            api_key=free_ai.api_key(),
            base_url=free_ai.base_url(),
            check_embedding_ctx_length=False,
        )
    if space.provider == "gemini":
        return GoogleGenerativeAIEmbeddings(model=space.model, google_api_key=api_key)
    if space.provider == "openrouter":
        return OpenAIEmbeddings(
            model=_OPENROUTER_EMBEDDING_MODELS[space.model],
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            default_headers=OPENROUTER_HEADERS,
            # 1536 is the model's native size; only send the option when reducing it
            dimensions=space.dimensions if space.dimensions != DEFAULT_DIMENSIONS else None,
            # Send plain strings: the default pre-tokenizes for OpenAI's own endpoint
            check_embedding_ctx_length=False,
        )
    return OpenAIEmbeddings(model=space.model, api_key=api_key, dimensions=space.dimensions)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else list(vector)


def _fit(vector: list[float], space: EmbeddingSpace) -> list[float]:
    """Zero-pad a shorter model output (Qwen3-Embedding's 1024) to the space's size."""
    if len(vector) > space.dimensions:
        raise EmbeddingError(
            f"The embedding model returned {len(vector)} dimensions; {space.dimensions} is the most the index takes.",
            502,
        )
    return vector + [0.0] * (space.dimensions - len(vector))


_PAYMENT_MARKERS = ("402", "payment required", "insufficient credits", "more credits")
_RATE_LIMIT_MARKERS = ("429", "rate limit", "rate_limit", "resource_exhausted", "quota")
_AUTH_MARKERS = ("api key not found", "api_key_invalid", "invalid api key", "incorrect api key", "401", "permission_denied")
_LABELS = {"gemini": "Gemini", "openai": "OpenAI", "openrouter": "OpenRouter"}


def _to_embedding_error(space: EmbeddingSpace, exc: Exception) -> EmbeddingError:
    if isinstance(exc, EmbeddingError):
        return exc
    if space.provider == "free":
        # The host's own server is down or the model isn't pulled: worth retrying later.
        free_ai.log_failure("embedding", exc)
        return EmbeddingError(free_ai.UNAVAILABLE_MESSAGE, 503)
    message = provider_error_message(exc)
    lowered = f"{message} {exc}".lower()
    label = _LABELS.get(space.provider, space.provider)
    # No credit for the (paid) embedding model: the API falls back to keyword search.
    if getattr(exc, "status_code", None) == 402 or any(marker in lowered for marker in _PAYMENT_MARKERS):
        return EmbeddingError(f"{label} embeddings need credit on this key: {message}", 402)
    if any(marker in lowered for marker in _RATE_LIMIT_MARKERS):
        return EmbeddingError(f"{label} embedding rate limit reached: {message}", 429)
    if any(marker in lowered for marker in _AUTH_MARKERS):
        return EmbeddingError("API key is invalid for the selected provider/model.", 401)
    return EmbeddingError(f"{label} embedding request failed: {message}", 502)


