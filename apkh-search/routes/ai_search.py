"""
API endpoints for AI RAG requests from the API orchestration layer.
"""

import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from services.limits import (
    MAX_CONTEXT_CHARS,
    MAX_CONTEXTS,
    MAX_HISTORY,
    MAX_ID_CHARS,
    MAX_MESSAGE_CHARS,
    MAX_QUERY_CHARS,
    MAX_TEXT_CHARS,
)
from services.embedder import EmbeddingError, embed_query as embed_query_text, resolve_space
from services.llm import (
    generate_note_summary,
    generate_rag_answer,
    has_credentials,
    rewrite_search_query,
    stream_rag_answer,
    test_llm_connection,
)
from services.sse import event_stream
from services.model_catalog import PROVIDERS, ModelListError, list_chat_models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["AI Search"])

Id = Annotated[str, Field(max_length=MAX_ID_CHARS)]
Query = Annotated[str, Field(max_length=MAX_QUERY_CHARS)]
Context = Annotated[str, Field(max_length=MAX_CONTEXT_CHARS)]


class EmbedQueryRequest(BaseModel):
    query: Query
    api_key: Id | None = None
    apiKey: Id | None = None
    model: Id | None = None
    # Embedding space chosen by the API; defaults to the provider's standard one.
    embedding_model: Id | None = None
    dimensions: int | None = Field(default=None, gt=0, le=8192)


class RagRequest(BaseModel):
    query: Query
    contexts: list[Context] = Field(max_length=MAX_CONTEXTS)
    api_key: Id | None = None
    apiKey: Id | None = None
    model: Id | None = None


class SummaryRequest(BaseModel):
    # brief: a compact summary · actions: tasks, decisions, deadlines and people
    mode: Literal["brief", "actions"] = "brief"
    note_id: Id | None = None
    title: Id | None = None
    category: Id | None = None
    content: Annotated[str, Field(max_length=MAX_TEXT_CHARS)] | None = None
    contexts: list[Context] | None = Field(default=None, max_length=MAX_CONTEXTS)
    api_key: Id | None = None
    apiKey: Id | None = None
    model: Id | None = None


class TestLLMRequest(BaseModel):
    api_key: Id | None = None
    apiKey: Id | None = None
    model: Id | None = None


class ListModelsRequest(BaseModel):
    provider: Id
    api_key: Id | None = None
    apiKey: Id | None = None


@router.post("/embed-query")
async def embed_query(body: EmbedQueryRequest, request: Request):
    """
    Generate an embedding vector for a single query string.
    """
    api_key = body.api_key or body.apiKey or ""
    model = body.model

    if not has_credentials(api_key, model):
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
    api_key = body.api_key or body.apiKey or ""
    model = body.model

    if not has_credentials(api_key, model):
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


@router.post("/rag/stream")
async def generate_rag_stream(body: RagRequest, request: Request):
    """/rag, streamed as server-sent events: token events, then one done event."""
    api_key = body.api_key or body.apiKey or ""
    if not has_credentials(api_key, body.model):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for answer generation.",
        )

    request_id = str(uuid.uuid4())
    events = stream_rag_answer(
        query=body.query,
        contexts=body.contexts,
        api_key=api_key,
        model=body.model,
        user_id=getattr(request.state, "user_id", None),
        request_id=request_id,
    )
    return event_stream(events, request_id=request_id)


@router.post("/summarize")
async def summarize_note(body: SummaryRequest, request: Request):
    """
    Generate a concise summary for a single note.
    """
    api_key = body.api_key or body.apiKey or ""
    model = body.model

    if not has_credentials(api_key, model):
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
    role: Annotated[str, Field(max_length=20)]
    content: Annotated[str, Field(max_length=MAX_MESSAGE_CHARS)]


class RewriteQueryRequest(BaseModel):
    query: Query
    # Recent messages, for follow-up questions in a chat
    history: list[ConversationMessage] = Field(default=[], max_length=MAX_HISTORY)
    api_key: Id
    model: Id


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
    api_key = body.api_key or body.apiKey or ""
    model = body.model

    if not has_credentials(api_key, model):
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
