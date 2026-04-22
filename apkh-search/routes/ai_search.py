"""
API endpoints for AI RAG requests from the API orchestration layer.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from services.embedder import generate_single_embedding
from services.llm import generate_note_summary, generate_rag_answer, test_llm_connection

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


class SummaryRequest(BaseModel):
    note_id: str | None = None
    title: str | None = None
    category: str | None = None
    content: str | None = None
    contexts: list[str] | None = None
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


class TestLLMRequest(BaseModel):
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


@router.post("/embed-query")
async def embed_query(body: EmbedQueryRequest, request: Request):
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
    except Exception as exc:
        logger.exception("Unexpected embedding error for model %s", model)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Embedding provider request failed unexpectedly.",
        ) from exc


@router.post("/rag")
async def generate_rag(body: RagRequest, request: Request):
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

    request_id = str(uuid.uuid4())
    user_id = getattr(request.state, "user_id", None)

    logger.info(
        "Generating RAG for AI query: %s (with %s contexts) [request_id=%s]",
        body.query,
        len(body.contexts),
        request_id,
    )
    result = await generate_rag_answer(
        query=body.query,
        contexts=body.contexts,
        api_key=api_key,
        model=model,
        user_id=user_id,
        request_id=request_id,
    )
    return {
        "answer": result["answer"],
        "tokens_used": result["tokens_used"],
        "request_id": request_id,
        "run_id": result.get("run_id"),
    }


@router.post("/summarize")
async def summarize_note(body: SummaryRequest, request: Request):
    """
    Generate a concise summary for a single note.
    """
    api_key = body.api_key or body.apiKey
    model = body.model

    if not api_key or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for summary generation.",
        )

    request_id = str(uuid.uuid4())
    user_id = getattr(request.state, "user_id", None)

    logger.info(
        "Generating note summary for note: %s with model %s [request_id=%s]",
        body.note_id or "unknown",
        model,
        request_id,
    )
    result = await generate_note_summary(
        title=body.title or "",
        category=body.category or "",
        content=body.content or "",
        contexts=body.contexts or [],
        api_key=api_key,
        model=model,
        user_id=user_id,
        request_id=request_id,
    )
    return {
        "summary": result["summary"],
        "tokens_used": result["tokens_used"],
        "request_id": request_id,
        "run_id": result.get("run_id"),
    }


@router.post("/test")
async def test_connection(body: TestLLMRequest, request: Request):
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

    request_id = str(uuid.uuid4())
    user_id = getattr(request.state, "user_id", None)

    logger.info("Testing LLM connection for model: %s [request_id=%s]", model, request_id)
    result = await test_llm_connection(
        api_key=api_key,
        model=model,
        user_id=user_id,
        request_id=request_id,
    )
    return result
