"""
Feedback endpoint for LangSmith run scoring.

Allows users to send thumbs-up / thumbs-down feedback on any traced run
so it appears in the LangSmith dashboard for evaluation.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from services.langsmith_config import get_langsmith_client, is_tracing_enabled

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["Feedback"])


class FeedbackRequest(BaseModel):
    run_id: str
    score: int  # 1 = positive (thumbs up), 0 = negative (thumbs down)
    comment: str | None = None


@router.post("")
async def submit_feedback(body: FeedbackRequest):
    """
    Submit user feedback (thumbs up/down) for a LangSmith traced run.

    - **run_id**: the LangSmith run ID returned from /ai-search/rag or /ai-search/summarize
    - **score**: 1 for positive, 0 for negative
    - **comment**: optional free-text comment
    """
    if not is_tracing_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LangSmith tracing is not configured. Feedback cannot be recorded.",
        )

    if body.score not in (0, 1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="score must be 0 (negative) or 1 (positive).",
        )

    client = get_langsmith_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LangSmith client is not available.",
        )

    try:
        client.create_feedback(
            run_id=body.run_id,
            key="user-feedback",
            score=body.score,
            comment=body.comment,
        )
        logger.info(
            "Feedback recorded for run %s: score=%s",
            body.run_id,
            body.score,
        )
        return {"status": "ok", "run_id": body.run_id}

    except Exception as exc:
        logger.error("Failed to submit feedback for run %s: %s", body.run_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to record feedback: {exc}",
        ) from exc
