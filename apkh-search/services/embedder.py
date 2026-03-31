"""
Embedding generator using Google Gemini API.
Uses gemini-embedding-001 model with output_dimensionality=768.
"""

import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Ensure .env is loaded independently in case of import ordering issues
load_dotenv()

# Initialize the Gemini client
GEMINI_KEY = os.getenv("GEMINI_KEY", "GEMINI_KEY")
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768


def get_client():
    """Get or create the Gemini client."""
    return genai.Client(api_key=GEMINI_KEY)


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Gemini gemini-embedding-001.

    Args:
        texts: List of text strings to embed

    Returns:
        List of embedding vectors (each is list of 768 floats)
    """
    if not texts:
        return []

    client = get_client()
    embeddings = []

    # Batch in groups of 100 (Gemini supports batching)
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=batch,
                config=types.EmbedContentConfig(
                    output_dimensionality=EMBEDDING_DIMENSIONS,
                ),
            )
            for embedding in result.embeddings:
                embeddings.append(embedding.values)

            logger.info(f"Generated embeddings for batch {i // batch_size + 1} "
                        f"({len(batch)} texts)")
        except Exception as e:
            logger.error(f"Embedding generation failed for batch {i // batch_size + 1}: {e}")
            # Fill with empty vectors for failed batch
            for _ in batch:
                embeddings.append([0.0] * EMBEDDING_DIMENSIONS)

    return embeddings


async def generate_single_embedding(text: str) -> list[float]:
    """Generate embedding for a single text."""
    results = await generate_embeddings([text])
    return results[0] if results else [0.0] * EMBEDDING_DIMENSIONS

