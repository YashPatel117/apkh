import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from services.limits import (
    MAX_CONTEXT_CHARS,
    MAX_CONTEXTS,
    MAX_HISTORY,
    MAX_ID_CHARS,
    MAX_MESSAGE_CHARS,
    MAX_QUERY_CHARS,
)
from services.llm import generate_chat_rag_answer, stream_chat_rag_answer
from services.sse import event_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["ChatRAG"])

Id = Annotated[str, Field(max_length=MAX_ID_CHARS)]
Context = Annotated[str, Field(max_length=MAX_CONTEXT_CHARS)]


class ChatHistoryMessage(BaseModel):
    role: Annotated[str, Field(max_length=20)]
    content: Annotated[str, Field(max_length=MAX_MESSAGE_CHARS)]


class ChatRagRequest(BaseModel):
    query: Annotated[str, Field(max_length=MAX_QUERY_CHARS)]
    chat_history: list[ChatHistoryMessage] = Field(max_length=MAX_HISTORY)
    current_chat_chunks: list[Context] = Field(max_length=MAX_CONTEXTS)
    notes_chunks: list[Context] = Field(max_length=MAX_CONTEXTS)
    similar_chat_chunks: list[Context] = Field(max_length=MAX_CONTEXTS)
    api_key: Id
    model: Id

@router.post("/chat-rag")
async def chat_rag(body: ChatRagRequest, request: Request):
    """
    Generate an AI response based on multi-source RAG context + conversational history.
    """
    request_id = str(uuid.uuid4())
    try:
        dict_history = [{"role": msg.role, "content": msg.content} for msg in body.chat_history]

        result = await generate_chat_rag_answer(
            query=body.query,
            chat_history=dict_history,
            current_chat_chunks=body.current_chat_chunks,
            notes_chunks=body.notes_chunks,
            similar_chat_chunks=body.similar_chat_chunks,
            api_key=body.api_key,
            model=body.model,
            user_id=getattr(request.state, "user_id", None),
            request_id=request_id,
        )
        return {**result, "error": result.get("error", False), "request_id": request_id}
    except Exception as e:
        logger.error(f"Chat RAG failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e)
        )


@router.post("/chat-rag/stream")
async def chat_rag_stream(body: ChatRagRequest, request: Request):
    """/chat-rag, streamed as server-sent events: token events, then one done event."""
    request_id = str(uuid.uuid4())
    events = stream_chat_rag_answer(
        query=body.query,
        chat_history=[{"role": msg.role, "content": msg.content} for msg in body.chat_history],
        current_chat_chunks=body.current_chat_chunks,
        notes_chunks=body.notes_chunks,
        similar_chat_chunks=body.similar_chat_chunks,
        api_key=body.api_key,
        model=body.model,
        user_id=getattr(request.state, "user_id", None),
        request_id=request_id,
    )
    return event_stream(events, request_id=request_id)
