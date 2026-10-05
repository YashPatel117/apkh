from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
import jwt
from jwt.exceptions import InvalidTokenError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
import logging
import os
import time

import httpx
import structlog

# Load environment variables
load_dotenv()

from services import builtin_ai  # noqa: E402  (reads env)
from services.builtin_ai import PRIORITY_HEADER, parse_priority, request_priority  # noqa: E402
from services.logging_config import REQUEST_ID_HEADER, configure_logging, request_id_from  # noqa: E402

configure_logging()
logger = logging.getLogger("apkh.search")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("apkh-search started")
    yield
    # uvicorn stops taking requests and waits for running ones before this
    # (timeout_graceful_shutdown); anything still streaming is cut off then.
    logger.info("apkh-search shutting down")


app = FastAPI(title="APKH Search Module", version="1.0.0", lifespan=lifespan)

# Paths that need no token
OPEN_PATHS = {"/open", "/docs", "/openapi.json", "/redoc", "/health", "/ready"}

# CORS — allow API module and frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3002").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JWT_SECRET_KEY = os.getenv("JWT_SECRET", "").strip()
if not JWT_SECRET_KEY:
    raise RuntimeError("Missing JWT_SECRET. Copy .env.example to .env and fill it in.")
JWT_ALGORITHM = "HS256"

bearer_scheme = HTTPBearer(auto_error=False)


@app.middleware("http")
async def attach_user_to_request(request: Request, call_next):
    if request.url.path in OPEN_PATHS:
        return await call_next(request)
    auth_header = request.headers.get("Authorization")

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY,
                                 algorithms=[JWT_ALGORITHM])
            user_id = payload.get("_id")

            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token payload"
                )

            request.state.user_id = user_id
            structlog.contextvars.bind_contextvars(user_id=str(user_id))

        except InvalidTokenError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid or expired token"}
            )
    else:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"}
        )

    # Queue position for the built-in AI, set by the API from the user's plan.
    request_priority.set(parse_priority(request.headers.get(PRIORITY_HEADER)))

    response = await call_next(request)
    return response


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Request id on every log line and on the response; one line per request."""
    structlog.contextvars.clear_contextvars()
    request_id = request_id_from(request.headers.get(REQUEST_ID_HEADER))
    structlog.contextvars.bind_contextvars(request_id=request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request failed", extra={"path": request.url.path})
        raise
    response.headers["X-Request-Id"] = request_id
    if request.url.path not in ("/health", "/ready"):
        level = logging.ERROR if response.status_code >= 500 else logging.WARNING if response.status_code >= 400 else logging.INFO
        structlog.get_logger("apkh.search.http").log(
            level,
            "request completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )
    return response


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("_id")
        if not user_id:
            raise HTTPException(
                status_code=401, detail="Invalid token payload")
        return user_id
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# Register routers
from routes.ingest import router as ingest_router
from routes.ai_search import router as ai_search_router
from routes.feedback import router as feedback_router
from routes.chat_rag import router as chat_rag_router
app.include_router(ingest_router)
app.include_router(ai_search_router)
app.include_router(feedback_router)
app.include_router(chat_rag_router)


@app.get("/users/me", tags=["Users"], summary="Get current user")
async def read_users_me(request: Request):
    return {"user_id":  getattr(request.state, "user_id", None)}


@app.get("/open", tags=["Public"], summary="Open route")
async def open_route():
    return {"message": "This route does not require authentication"}


@app.get("/health", tags=["Health"], summary="Liveness")
async def health():
    return {"status": "ok", "service": "apkh-search"}


@app.get("/ready", tags=["Health"], summary="Readiness")
async def ready():
    """Ready to serve. The built-in AI is reported, not required (users may bring their own keys)."""
    builtin = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{builtin_ai.base_url()}/models", headers={"Authorization": f"Bearer {builtin_ai.api_key()}"})
            builtin = response.status_code == 200
    except httpx.HTTPError:
        builtin = False
    return {"status": "ready", "checks": {"builtin_ai": builtin}}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "true").lower() != "false",
        # Our JSON logging, not uvicorn's default config
        log_config=None,
        # On Ctrl+C / SIGTERM, running requests get this long to finish.
        timeout_graceful_shutdown=30,
    )
