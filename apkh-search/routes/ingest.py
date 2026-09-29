"""
Indexing endpoints, called by the API's indexing worker.

Indexing is split in three so the API can skip whatever hasn't changed:
  /ingest/extract  download attachments and read their text (the expensive
                   part: images and scanned PDF pages go to the user's model)
  /ingest/chunk    split note / chat / attachment text into chunks (local)
  /ingest/embed    embed chunk texts with the user's provider
"""

import asyncio
import base64
import logging
import os
import struct
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.chunker import chunk_document
from services.embedder import EmbeddingError, embed_documents, estimate_tokens, resolve_space
from services.file_extractor import ImageReader, extract_text_from_bytes
from services.html_parser import parse_note_html
from services.vision import VisionUsage, build_image_reader

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["Ingestion"])

# Same variable (and format) as apkh-api, e.g. https://apkh-storage.onrender.com/
STORAGE_BASE_URL = os.getenv("STORAGE_API_URL", "http://localhost:3001").rstrip("/")

FileStatus = Literal["ok", "empty", "unsupported", "no_vision", "missing", "failed"]


# ── /ingest/extract ─────────────────────────────────────────────────────────


class ExtractRequest(BaseModel):
    note_id: str
    user_id: str | None = None
    files: list[str]
    api_key: str
    model: str


class ExtractedFile(BaseModel):
    file_name: str
    # ok: text extracted · empty: nothing to read · unsupported: file type not
    # handled · no_vision: needs a model that reads images · missing: not in
    # storage · failed: download or read error (worth retrying)
    status: FileStatus
    method: str | None = None
    text: str = ""
    page_count: int = 0
    warning: str | None = None
    error: str | None = None


class ExtractResponse(BaseModel):
    files: list[ExtractedFile]
    tokens_used: int


@router.post("/extract", response_model=ExtractResponse)
async def extract_files(body: ExtractRequest, request: Request):
    """Download attachments from storage and extract their text."""
    usage = VisionUsage()
    read_image = build_image_reader(
        body.api_key,
        body.model,
        user_id=body.user_id,
        request_id=body.note_id,
        usage=usage,
    )
    if read_image is None:
        logger.warning(
            "Model %s cannot read images; image attachments and scanned PDF pages will be skipped",
            body.model,
        )

    files = await _fetch_and_extract_files(
        request.headers.get("Authorization", ""),
        body.note_id,
        body.files,
        read_image,
    )
    logger.info(
        "Extracted %s file(s) for note %s: %s",
        len(files),
        body.note_id,
        ", ".join(f"{f.file_name}={f.status}" for f in files),
    )
    return ExtractResponse(files=files, tokens_used=usage.tokens_used)


async def _fetch_and_extract_files(
    auth_header: str,
    note_id: str,
    filenames: list[str],
    read_image: ImageReader | None,
) -> list[ExtractedFile]:
    """Fetch files from the storage service and extract text from each."""
    if not filenames:
        return []

    semaphore = asyncio.Semaphore(6)

    async with httpx.AsyncClient(timeout=60.0) as client:
        async def _fetch_one(filename: str) -> ExtractedFile:
            try:
                async with semaphore:
                    url = f"{STORAGE_BASE_URL}/files/{note_id}/{filename}"
                    response = await client.get(url, headers={"Authorization": auth_header})
                    if response.status_code == 404:
                        return ExtractedFile(file_name=filename, status="missing", error="File not found in storage.")
                    if response.status_code != 200:
                        return ExtractedFile(
                            file_name=filename,
                            status="failed",
                            error=f"Download failed (HTTP {response.status_code}).",
                        )
                    extraction = await extract_text_from_bytes(response.content, filename, read_image)
                    return _to_extracted_file(extraction, can_read_images=read_image is not None)
            except Exception as exc:
                logger.error("Error processing file %s: %s", filename, exc)
                return ExtractedFile(file_name=filename, status="failed", error=str(exc) or type(exc).__name__)

        return list(await asyncio.gather(*[_fetch_one(filename) for filename in filenames]))


def _to_extracted_file(extraction: dict, can_read_images: bool) -> ExtractedFile:
    method = extraction.get("extraction_method")
    text = (extraction.get("extracted_text") or "").strip()
    unread_pages = extraction.get("unread_pages") or 0
    result = ExtractedFile(
        file_name=extraction["file_name"],
        status="ok",
        method=method,
        text=text,
        page_count=extraction.get("page_count") or 0,
    )

    if method == "unsupported":
        result.status = "unsupported"
    elif method == "image_no_vision":
        result.status = "no_vision"
    elif method in ("error", "image_vision_failed"):
        result.status = "failed"
        result.error = "The file could not be read."
    elif not text:
        if unread_pages and not can_read_images:
            result.status = "no_vision"
        elif unread_pages:
            result.status = "failed"
            result.error = "The model could not read the scanned pages."
        else:
            result.status = "empty"
    elif unread_pages:
        result.warning = f"{unread_pages} scanned or blank page(s) had no readable text."
    return result


# ── /ingest/chunk ───────────────────────────────────────────────────────────


class ChunkFileSource(BaseModel):
    file_name: str
    text: str


class ChunkRequest(BaseModel):
    content: str = ""
    # Notes are Quill HTML; chat transcripts are plain text.
    content_format: Literal["html", "text"] = "html"
    source_type: Literal["note", "chat"] = "note"
    files: list[ChunkFileSource] = []


class ChunkOut(BaseModel):
    text: str
    source_type: str
    source_name: str | None = None
    source_page: int | None = None


class ChunkResponse(BaseModel):
    chunks: list[ChunkOut]


@router.post("/chunk", response_model=ChunkResponse)
def chunk(body: ChunkRequest):
    """Split the main text and any extracted file texts into token-sized chunks."""
    if body.content_format == "html":
        parsed = parse_note_html(body.content)
        text = parsed.text_content
        if parsed.links:
            link_lines = [f"  - {link['text']} ({link['href']})" for link in parsed.links]
            text += "\n\nLinks:\n" + "\n".join(link_lines)
    else:
        text = body.content

    extractions = [{"file_name": f.file_name, "extracted_text": f.text} for f in body.files]
    chunks = chunk_document(text, extractions, main_source_type=body.source_type)
    return ChunkResponse(
        chunks=[
            ChunkOut(
                text=c["text"],
                source_type=c["source_type"],
                source_name=c.get("source_name"),
                source_page=c.get("source_page"),
            )
            for c in chunks
        ]
    )


# ── /ingest/embed ───────────────────────────────────────────────────────────


class EmbedRequest(BaseModel):
    texts: list[str]
    api_key: str
    model: str
    embedding_model: str | None = None
    dimensions: int | None = None


class EmbedResponse(BaseModel):
    # Each vector as base64 little-endian float32 — about 5x smaller than JSON numbers.
    vectors: list[str]
    embedding_model: str
    dimensions: int
    # Estimated locally; embedding responses don't carry usage through langchain.
    tokens_used: int


@router.post("/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest):
    """Embed chunk texts in the requested embedding space."""
    try:
        space = resolve_space(body.model, body.embedding_model, body.dimensions)
        vectors = await embed_documents(body.texts, body.api_key, space)
    except EmbeddingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return EmbedResponse(
        vectors=[encode_vector(vector) for vector in vectors],
        embedding_model=space.model,
        dimensions=space.dimensions,
        tokens_used=estimate_tokens(body.texts),
    )


def encode_vector(vector: list[float]) -> str:
    return base64.b64encode(struct.pack(f"<{len(vector)}f", *vector)).decode("ascii")
