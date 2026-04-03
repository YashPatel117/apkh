"""
Embedding generator using the active user's provider credentials.

Gemini and OpenAI are supported for embeddings. Anthropic models can still be
used for answer generation, but Anthropic does not currently offer a compatible
embedding endpoint for this retrieval flow.
"""

import logging
import re
from typing import Any

from services.llm import detect_provider

logger = logging.getLogger(__name__)

GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
GEMINI_EMBEDDING_DIMENSIONS = 768
GEMINI_FALLBACK_EMBEDDING_MODEL = "text-embedding-004"
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"


def _extract_provider_error_message(exc: Exception) -> str:
    """
    Turn SDK/provider exceptions into a clean message that can be sent to clients.
    """
    response_json: Any = getattr(exc, "response_json", None)
    if isinstance(response_json, dict):
        error = response_json.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()

        message = response_json.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()

    message = str(exc).strip()
    if not message:
        return exc.__class__.__name__

    lowered = message.lower()
    if (
        "api key not found" in lowered
        or "api_key_invalid" in lowered
        or "invalid api key" in lowered
    ):
        return "API key is invalid for the selected provider/model."

    single_quoted_message = re.search(r"'message':\s*'([^']+)'", message)
    if single_quoted_message and single_quoted_message.group(1).strip():
        return single_quoted_message.group(1).strip()

    double_quoted_message = re.search(r'"message"\s*:\s*"([^"]+)"', message)
    if double_quoted_message and double_quoted_message.group(1).strip():
        return double_quoted_message.group(1).strip()

    return message


async def _generate_gemini_embeddings(texts: list[str], api_key: str) -> list[list[float]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    candidate_models = [GEMINI_EMBEDDING_MODEL, GEMINI_FALLBACK_EMBEDDING_MODEL]
    last_exception: Exception | None = None

    for candidate_model in candidate_models:
        try:
            embeddings: list[list[float]] = []
            batch_size = 100
            for index in range(0, len(texts), batch_size):
                batch = texts[index:index + batch_size]
                result = client.models.embed_content(
                    model=candidate_model,
                    contents=batch,
                    config=types.EmbedContentConfig(
                        output_dimensionality=GEMINI_EMBEDDING_DIMENSIONS,
                    ),
                )

                for embedding in result.embeddings:
                    embeddings.append(embedding.values)

                logger.info(
                    "Generated Gemini embeddings for batch %s (%s texts) using %s",
                    index // batch_size + 1,
                    len(batch),
                    candidate_model,
                )

            return embeddings
        except Exception as exc:  # pragma: no cover - provider-specific behavior
            last_exception = exc
            logger.warning(
                "Gemini embedding attempt failed on model %s: %s",
                candidate_model,
                _extract_provider_error_message(exc),
            )

    if last_exception is not None:
        raise ValueError(
            f"Gemini embedding request failed: {_extract_provider_error_message(last_exception)}"
        ) from last_exception

    raise ValueError("Gemini embedding request failed for an unknown reason.")


async def _generate_openai_embeddings(texts: list[str], api_key: str) -> list[list[float]]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)

    try:
        embeddings: list[list[float]] = []

        batch_size = 100
        for index in range(0, len(texts), batch_size):
            batch = texts[index:index + batch_size]
            result = await client.embeddings.create(
                model=OPENAI_EMBEDDING_MODEL,
                input=batch,
            )

            for item in sorted(result.data, key=lambda entry: entry.index):
                embeddings.append(item.embedding)

            logger.info(
                "Generated OpenAI embeddings for batch %s (%s texts)",
                index // batch_size + 1,
                len(batch),
            )

        return embeddings
    except Exception as exc:  # pragma: no cover - provider-specific behavior
        raise ValueError(
            f"OpenAI embedding request failed: {_extract_provider_error_message(exc)}"
        ) from exc


async def generate_embeddings(
    texts: list[str],
    api_key: str,
    model: str,
) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using the active user's provider.
    """
    if not texts:
        return []

    resolved_key = api_key.strip()
    resolved_model = model.strip()

    if not resolved_key or not resolved_model:
        raise ValueError("api_key and model are required for embedding generation.")

    provider = detect_provider(resolved_model)

    if provider == "gemini":
        return await _generate_gemini_embeddings(texts, resolved_key)

    if provider == "openai":
        return await _generate_openai_embeddings(texts, resolved_key)

    raise ValueError(
        "Anthropic models are not supported for semantic search embeddings yet. "
        "Use a Gemini or OpenAI config for AI search."
    )


async def generate_single_embedding(text: str, api_key: str, model: str) -> list[float]:
    """Generate an embedding for a single text."""
    results = await generate_embeddings([text], api_key, model)
    return results[0] if results else []
