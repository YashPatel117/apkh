"""
LangSmith tracing configuration and helpers.

Provides callback builders and a shared LangSmith client for the feedback API.
All helpers degrade gracefully when tracing is not configured.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_langsmith_client = None


def is_tracing_enabled() -> bool:
    """Return True when LangSmith tracing is fully configured."""
    return (
        os.getenv("LANGCHAIN_TRACING_V2", "").lower() == "true"
        and bool(os.getenv("LANGCHAIN_API_KEY", "").strip())
        and os.getenv("LANGCHAIN_API_KEY", "").strip() != "your-langsmith-api-key"
    )


def get_langsmith_client():
    """Return a lazily-initialised LangSmith client (singleton)."""
    global _langsmith_client
    if _langsmith_client is None:
        try:
            from langsmith import Client

            _langsmith_client = Client()
            logger.info("LangSmith client initialised (project=%s)", os.getenv("LANGCHAIN_PROJECT"))
        except Exception as exc:
            logger.warning("Failed to create LangSmith client: %s", exc)
            return None
    return _langsmith_client


def build_trace_callbacks(
    *,
    run_name: str,
    metadata: dict[str, Any] | None = None,
) -> list:
    """
    Build a list of LangChain callbacks for a single invocation.

    If tracing is disabled the returned list is empty, so callers can always
    do ``config={"callbacks": build_trace_callbacks(...)}``.
    """
    if not is_tracing_enabled():
        return []

    try:
        from langchain_core.tracers import LangChainTracer

        tracer = LangChainTracer(
            project_name=os.getenv("LANGCHAIN_PROJECT", "apkh-search"),
        )
        # Attach run_name and metadata via the run_name/tags/metadata
        # These will be passed through config, not set on the tracer directly
        return [tracer], run_name, metadata or {}
    except Exception as exc:
        logger.warning("Could not build LangSmith tracer: %s", exc)
        return [], None, {}


def build_langchain_config(
    *,
    run_name: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build a LangChain RunnableConfig dict with tracing callbacks,
    run_name, and metadata.  Safe to pass directly to ``ainvoke(config=...)``.

    Returns an empty dict when tracing is disabled so existing behaviour
    is completely unchanged.
    """
    if not is_tracing_enabled():
        return {}

    try:
        from langchain_core.tracers import LangChainTracer

        tracer = LangChainTracer(
            project_name=os.getenv("LANGCHAIN_PROJECT", "apkh-search"),
        )
        config: dict[str, Any] = {
            "callbacks": [tracer],
            "run_name": run_name,
            "metadata": metadata or {},
        }
        return config
    except Exception as exc:
        logger.warning("Could not build LangSmith config: %s", exc)
        return {}
