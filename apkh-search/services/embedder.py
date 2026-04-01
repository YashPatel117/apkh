"""
Embedding generator using the active user's provider credentials.

Gemini and OpenAI are supported for embeddings. Anthropic models can still be
used for answer generation, but Anthropic does not currently offer a compatible
embedding endpoint for this retrieval flow.
"""

import logging

from services.llm import detect_provider

logger = logging.getLogger(__name__)

GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
GEMINI_EMBEDDING_DIMENSIONS = 768
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
async def _generate_gemini_embeddings(texts: list[str], api_key: str) -> list[list[float]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    embeddings: list[list[float]] = []

    batch_size = 100
    for index in range(0, len(texts), batch_size):
        batch = texts[index:index + batch_size]
        result = client.models.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            contents=batch,
            config=types.EmbedContentConfig(
                output_dimensionality=GEMINI_EMBEDDING_DIMENSIONS,
            ),
        )

        for embedding in result.embeddings:
            embeddings.append(embedding.values)

        logger.info(
            "Generated Gemini embeddings for batch %s (%s texts)",
            index // batch_size + 1,
            len(batch),
        )

    return embeddings


async def _generate_openai_embeddings(texts: list[str], api_key: str) -> list[list[float]]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
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
