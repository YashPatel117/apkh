"""
Structured (JSON) logs. Every line carries the request id that apkh-api sent
as X-Request-Id, so one request can be followed across the services.

LOG_LEVEL sets the level (default INFO); LOG_FORMAT=pretty prints readable
lines instead of JSON, for local development.
"""

import logging
import os
import uuid

import structlog

REQUEST_ID_HEADER = "x-request-id"


def configure_logging() -> None:
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
    ]
    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    renderer = (
        structlog.dev.ConsoleRenderer()
        if os.getenv("LOG_FORMAT", "").strip().lower() == "pretty"
        else structlog.processors.JSONRenderer()
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        # Plain `logging` calls (this codebase, libraries) get the same fields.
        foreign_pre_chain=shared,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            renderer,
        ],
    )
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())

    # uvicorn's loggers go through the same handler; requests are logged by
    # the request middleware instead of uvicorn's access log.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
    # httpx logs every outgoing request (provider calls, model lists) at INFO
    logging.getLogger("httpx").setLevel(logging.WARNING)


def request_id_from(header_value: str | None) -> str:
    """The caller's request id if it looks like one, else a new id."""
    if header_value and len(header_value) <= 100 and all(c.isalnum() or c in "-_" for c in header_value):
        return header_value
    return str(uuid.uuid4())


def current_request_id() -> str | None:
    return structlog.contextvars.get_contextvars().get("request_id")


def correlation_headers() -> dict[str, str]:
    """Headers for calls to the other services (storage downloads)."""
    request_id = current_request_id()
    return {REQUEST_ID_HEADER: request_id} if request_id else {}
