from fastapi import FastAPI, Request, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
import jwt
from jwt.exceptions import InvalidTokenError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

app = FastAPI(title="APKH Search Module", version="1.0.0")

# CORS — allow API module and frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JWT_SECRET_KEY = "0ef16fe111b8e19e2d58fa0a17c5f214c6742616163eec3db89013dec3eb282bfa88294224d42317aab605fb224b494b26f575f665a28c9f65332f14c1a22210"
JWT_ALGORITHM = "HS256"

bearer_scheme = HTTPBearer(auto_error=False)


@app.middleware("http")
async def attach_user_to_request(request: Request, call_next):
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

        except InvalidTokenError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid or expired token"}
            )
    else:

        open_paths = ["/open", "/docs", "/openapi.json", "/redoc"]
        if request.url.path not in open_paths:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"}
            )

    response = await call_next(request)
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
app.include_router(ingest_router)
app.include_router(ai_search_router)
app.include_router(feedback_router)


@app.get("/users/me", tags=["Users"], summary="Get current user")
async def read_users_me(request: Request):
    return {"user_id":  getattr(request.state, "user_id", None)}


@app.get("/open", tags=["Public"], summary="Open route")
async def open_route():
    return {"message": "This route does not require authentication"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
