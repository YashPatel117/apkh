"""
API endpoints for AI RAG requests from the API orchestration layer.
"""

import logging
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from services.embedder import EmbeddingError, embed_query as embed_query_text, resolve_space
from services.llm import (
    generate_note_summary,
    generate_rag_answer,
    rewrite_search_query,
    test_llm_connection,
)
from services.model_catalog import PROVIDERS, ModelListError, list_chat_models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["AI Search"])


class EmbedQueryRequest(BaseModel):
    query: str
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None
    # Embedding space chosen by the API; defaults to the provider's standard one.
    embedding_model: str | None = None
    dimensions: int | None = None


class RagRequest(BaseModel):
    query: str
    contexts: list[str]
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


class SummaryRequest(BaseModel):
    # brief: a compact summary · actions: tasks, decisions, deadlines and people
    mode: Literal["brief", "actions"] = "brief"
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


class ListModelsRequest(BaseModel):
    provider: str
    api_key: str | None = None
    apiKey: str | None = None


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

    try:
        space = resolve_space(model, body.embedding_model, body.dimensions)
        embedding = await embed_query_text(body.query, api_key, space)
    except EmbeddingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {
        "embedding": embedding,
        "embedding_model": space.model,
        "dimensions": space.dimensions,
    }


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
        "error": result.get("error", False),
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

    result = await generate_note_summary(
        title=body.title or "",
        category=body.category or "",
        content=body.content or "",
        contexts=body.contexts or [],
        api_key=api_key,
        model=model,
        user_id=user_id,
        request_id=request_id,
        mode=body.mode,
    )
    return {
        "summary": result["summary"],
        "actions": result.get("actions"),
        "error": result.get("error", False),
        "tokens_used": result["tokens_used"],
        "request_id": request_id,
        "run_id": result.get("run_id"),
    }


class ConversationMessage(BaseModel):
    role: str
    content: str


class RewriteQueryRequest(BaseModel):
    query: str
    # Recent messages, for follow-up questions in a chat
    history: list[ConversationMessage] = []
    api_key: str
    model: str


@router.post("/rewrite-query")
async def rewrite_query(body: RewriteQueryRequest, request: Request):
    """
    Rewrite a vague or follow-up question into a standalone search query plus
    extra keywords. Falls back to the original query (error: true) on failure.
    """
    request_id = str(uuid.uuid4())
    result = await rewrite_search_query(
        query=body.query,
        history=[message.model_dump() for message in body.history],
        api_key=body.api_key,
        model=body.model,
        user_id=getattr(request.state, "user_id", None),
        request_id=request_id,
    )
    return result


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

    result = await test_llm_connection(
        api_key=api_key,
        model=model,
        user_id=user_id,
        request_id=request_id,
    )
    return result


@router.post("/models")
async def list_models(body: ListModelsRequest):
    """
    List the models the given API key can use, fetched live from the provider.
    """
    api_key = (body.api_key or body.apiKey or "").strip()

    if not api_key or body.provider not in PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"api_key and a provider ({', '.join(PROVIDERS)}) are required.",
        )

    try:
        models = await list_chat_models(body.provider, api_key)
    except ModelListError as exc:
        return {"ok": False, "error": str(exc), "models": []}

    return {"ok": True, "error": None, "models": models}
