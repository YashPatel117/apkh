"""
API endpoints for AI RAG requests from the API orchestration layer.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from services.embedder import generate_single_embedding
from services.llm import generate_rag_answer, test_llm_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["AI Search"])


class EmbedQueryRequest(BaseModel):
    query: str
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


class RagRequest(BaseModel):
    query: str
    contexts: list[str]
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


class TestLLMRequest(BaseModel):
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


@router.post("/embed-query")
async def embed_query(body: EmbedQueryRequest):
    """
    Generate an embedding vector for a single query string.
    """
    api_key = body.api_key or body.apiKey
    model = body.model

    if not api_key or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for semantic search.",
        )

    logger.info("Embedding AI query for model: %s", model)
    try:
        embedding = await generate_single_embedding(
            body.query,
            api_key,
            model,
        )
        return {"embedding": embedding}
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/rag")
async def generate_rag(body: RagRequest):
    """
    Feed context chunks and query to the active user's LLM provider.
    """
    api_key = body.api_key or body.apiKey
    model = body.model

    if not api_key or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for answer generation.",
        )

    logger.info(
        "Generating RAG for AI query: %s (with %s contexts)",
        body.query,
        len(body.contexts),
    )
    result = await generate_rag_answer(
        query=body.query,
        contexts=body.contexts,
        api_key=api_key,
        model=model,
    )
    return {"answer": result["answer"], "tokens_used": result["tokens_used"]}


@router.post("/test")
async def test_connection(body: TestLLMRequest):
    """
    Validate that a given API key + model combo actually works.
    """
    api_key = body.api_key or body.apiKey
    model = body.model

    if not api_key or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for connection testing.",
        )

    logger.info("Testing LLM connection for model: %s", model)
    result = await test_llm_connection(api_key=api_key, model=model)
    return result
