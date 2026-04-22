"""
Embedding generator using the active user's provider credentials.

Gemini and OpenAI are supported for embeddings. Anthropic models can still be
used for answer generation, but Anthropic does not currently offer a compatible
embedding endpoint for this retrieval flow.
"""

import asyncio
import logging
import re
from typing import Any

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_openai import OpenAIEmbeddings

from services.llm import detect_provider

logger = logging.getLogger(__name__)

GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
GEMINI_FALLBACK_EMBEDDING_MODEL = "text-embedding-004"
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
EMBED_BATCH_SIZE = 100


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
    candidate_models = [GEMINI_EMBEDDING_MODEL, GEMINI_FALLBACK_EMBEDDING_MODEL]
    last_exception: Exception | None = None

    for candidate_model in candidate_models:
        try:
            embedder = GoogleGenerativeAIEmbeddings(
                model=candidate_model,
                google_api_key=api_key,
                task_type="retrieval_document",
            )
            embeddings = await _embed_in_batches(
                texts=texts,
                embedder=embedder,
                provider_label="Gemini",
                model_label=candidate_model,
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
    try:
        embedder = OpenAIEmbeddings(
            model=OPENAI_EMBEDDING_MODEL,
            api_key=api_key,
        )
        return await _embed_in_batches(
            texts=texts,
            embedder=embedder,
            provider_label="OpenAI",
            model_label=OPENAI_EMBEDDING_MODEL,
        )
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
    normalized_texts = [text if text.strip() else " " for text in texts]

    if provider == "gemini":
        return await _generate_gemini_embeddings(normalized_texts, resolved_key)

    if provider == "openai":
        return await _generate_openai_embeddings(normalized_texts, resolved_key)

    raise ValueError(
        "Anthropic models are not supported for semantic search embeddings yet. "
        "Use a Gemini or OpenAI config for AI search."
    )


async def generate_single_embedding(text: str, api_key: str, model: str) -> list[float]:
    """Generate an embedding for a single text."""
    results = await generate_embeddings([text], api_key, model)
    return results[0] if results else []


async def _embed_in_batches(
    texts: list[str],
    embedder: Any,
    provider_label: str,
    model_label: str,
) -> list[list[float]]:
    embeddings: list[list[float]] = []

    for index in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[index:index + EMBED_BATCH_SIZE]
        batch_embeddings = await asyncio.to_thread(embedder.embed_documents, batch)
        embeddings.extend(batch_embeddings)
        logger.info(
            "Generated %s embeddings for batch %s (%s texts) using %s",
            provider_label,
            index // EMBED_BATCH_SIZE + 1,
            len(batch),
            model_label,
        )

    return embeddings
