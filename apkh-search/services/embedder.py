"""
Embeddings with the user's own provider credentials.

The API chooses the embedding model and dimensions (one "embedding space" per
provider) and stores that space next to every vector, so vectors from different
spaces are never compared. Gemini and OpenAI have embedding models; Anthropic
does not, so Claude users get keyword search instead.

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

from services.llm import detect_provider, provider_error_message

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODELS = {
    "gemini": "gemini-embedding-001",
    "openai": "text-embedding-3-small",
}
DEFAULT_DIMENSIONS = 1536
EMBED_BATCH_SIZE = 100

# Only models whose output the API knows how to label as a space.
_SUPPORTED_DIMENSIONS = {
    "gemini-embedding-001": {768, 1536, 3072},
    "text-embedding-3-small": {512, 1536},
}

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
    embedder = _build_embedder(api_key.strip(), space)
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
            vectors.extend(_normalize(vector) for vector in batch_vectors)
    except Exception as exc:  # pragma: no cover - provider-specific behavior
        raise _to_embedding_error(space, exc) from exc

    return vectors


async def embed_query(text: str, api_key: str, space: EmbeddingSpace) -> list[float]:
    """Embed a search query (Gemini: RETRIEVAL_QUERY task type, which pairs with documents)."""
    embedder = _build_embedder(api_key.strip(), space)
    try:
        if space.provider == "gemini":
            vector = await embedder.aembed_query(
                text,
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=space.dimensions,
            )
        else:
            vector = await embedder.aembed_query(text)
    except Exception as exc:  # pragma: no cover - provider-specific behavior
        raise _to_embedding_error(space, exc) from exc
    return _normalize(vector)


def _build_embedder(api_key: str, space: EmbeddingSpace) -> Any:
    if space.provider == "gemini":
        return GoogleGenerativeAIEmbeddings(model=space.model, google_api_key=api_key)
    return OpenAIEmbeddings(model=space.model, api_key=api_key, dimensions=space.dimensions)


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else list(vector)


_RATE_LIMIT_MARKERS = ("429", "rate limit", "rate_limit", "resource_exhausted", "quota")
_AUTH_MARKERS = ("api key not found", "api_key_invalid", "invalid api key", "incorrect api key", "401", "permission_denied")


def _to_embedding_error(space: EmbeddingSpace, exc: Exception) -> EmbeddingError:
    message = provider_error_message(exc)
    lowered = f"{message} {exc}".lower()
    label = "Gemini" if space.provider == "gemini" else "OpenAI"
    if any(marker in lowered for marker in _RATE_LIMIT_MARKERS):
        return EmbeddingError(f"{label} embedding rate limit reached: {message}", 429)
    if any(marker in lowered for marker in _AUTH_MARKERS):
        return EmbeddingError("API key is invalid for the selected provider/model.", 401)
    return EmbeddingError(f"{label} embedding request failed: {message}", 502)


