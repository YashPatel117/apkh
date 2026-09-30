import logging
import uuid

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from services.llm import generate_chat_rag_answer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["ChatRAG"])

class ChatHistoryMessage(BaseModel):
    role: str
    content: str

class ChatRagRequest(BaseModel):
    query: str
    chat_history: list[ChatHistoryMessage]
    current_chat_chunks: list[str]
    notes_chunks: list[str]
    similar_chat_chunks: list[str]
    api_key: str
    model: str

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
