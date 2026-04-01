"""
API Endpoints for handling AI RAG requests natively from the DB/API orchestration layer.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from services.embedder import generate_single_embedding
from services.llm import generate_rag_answer, test_llm_connection

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-search", tags=["AI Search"])


class EmbedQueryRequest(BaseModel):
    query: str


class RagRequest(BaseModel):
    query: str
    contexts: list[str]
    api_key: str | None = None   # user's decrypted key (passed by NestJS)
    model: str | None = None     # user's chosen model


class TestLLMRequest(BaseModel):
    api_key: str
    model: str


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
    Feed context chunks and query to the configured LLM provider.
    Return generated final answer along with token usage.
    """
    logger.info(f"Generating RAG for AI query: {body.query} (with {len(body.contexts)} contexts)")
    result = await generate_rag_answer(
        query=body.query,
        contexts=body.contexts,
        api_key=body.api_key,
        model=body.model,
    )
    return {"answer": result["answer"], "tokens_used": result["tokens_used"]}


@router.post("/test")
async def test_connection(body: TestLLMRequest):
    """
    Validate that a given API key + model combo actually works.
    Called before saving settings to DB.
    """
    logger.info(f"Testing LLM connection for model: {body.model}")
    result = await test_llm_connection(api_key=body.api_key, model=body.model)
    return result
