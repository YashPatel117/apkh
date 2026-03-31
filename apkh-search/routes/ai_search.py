"""
API Endpoints for handling AI RAG requests natively from the DB/API orchestration layer.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from services.embedder import generate_single_embedding
from services.llm import generate_rag_answer

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["AI Search"])


class EmbedQueryRequest(BaseModel):
    query: str


class RagRequest(BaseModel):
    query: str
    contexts: list[str]


@router.post("/embed-query")
async def embed_query(body: EmbedQueryRequest):
    """
    Generate an embedding vector for a single query string.
    Returns the vector to the calling API payload.
    """
    logger.info(f"Embedding AI query: {body.query}")
    embedding = await generate_single_embedding(body.query)
    return {"embedding": embedding}


@router.post("/rag")
async def generate_rag(body: RagRequest):
    """
    Feed context chunks and query to Gemini.
    Return generated final answer.
    """
    logger.info(f"Generating RAG for AI query: {body.query} (with {len(body.contexts)} contexts)")
    answer = await generate_rag_answer(body.query, body.contexts)
    return {"answer": answer}
