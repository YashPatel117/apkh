"""
Ingestion endpoint.
Receives note data, processes content + files, generates chunks & embeddings.
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from services.chunker import chunk_document
from services.embedder import generate_embeddings
from services.file_extractor import extract_text_from_bytes
from services.html_parser import parse_note_html

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["Ingestion"])

STORAGE_BASE_URL = "http://localhost:3001"


class IngestRequest(BaseModel):
    note_id: str
    user_id: str
    title: str
    content: str
    files: list[str] = []
    api_key: str | None = None
    apiKey: str | None = None
    model: str | None = None


class ChunkResponse(BaseModel):
    chunk_index: int
    text: str
    source_type: str
    source_name: str | None = None
    source_page: int | None = None
    embedding: list[float]


class IngestResponse(BaseModel):
    note_id: str
    chunks: list[ChunkResponse]
    chunk_count: int
    status: str


@router.post("", response_model=IngestResponse)
async def ingest_note(body: IngestRequest, request: Request):
    """
    Process a note for AI indexing:
    1. Parse HTML into text + file tokens
    2. Fetch and extract text from attached files
    3. Chunk the combined text
    4. Generate embeddings using the user's active provider credentials
    5. Return chunks + embeddings
    """
    logger.info("Ingestion started for note: %s", body.note_id)

    auth_header = request.headers.get("Authorization", "")
    api_key = body.api_key or body.apiKey
    model = body.model

    if not api_key or not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key and model are required for note ingestion.",
        )

    parsed = parse_note_html(body.content)
    logger.info(
        "Parsed note: %s chars text, %s file tokens, %s links",
        len(parsed.text_content),
        len(parsed.file_tokens),
        len(parsed.links),
    )

    note_text = parsed.text_content
    if parsed.links:
        link_lines = [f"  - {link['text']} ({link['href']})" for link in parsed.links]
        note_text += "\n\nLinks:\n" + "\n".join(link_lines)

    file_extractions = []
    if body.files:
        file_extractions = await _fetch_and_extract_files(
            auth_header,
            body.note_id,
            body.files,
        )
        logger.info("Extracted text from %s files", len(file_extractions))

    chunks = chunk_document(note_text, file_extractions)
    logger.info("Created %s chunks", len(chunks))

    if not chunks:
        chunks = [
            {
                "chunk_index": 0,
                "text": body.title,
                "source_type": "note",
                "char_start": 0,
                "char_end": len(body.title),
            }
        ]

    texts_to_embed = [chunk["text"] for chunk in chunks]
    try:
        embeddings = await generate_embeddings(
            texts_to_embed,
            api_key,
            model,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected embedding error during ingestion for note %s",
            body.note_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Embedding provider request failed unexpectedly.",
        ) from exc

    logger.info("Generated %s embeddings", len(embeddings))

    chunk_responses = []
    for chunk, embedding in zip(chunks, embeddings):
        chunk_responses.append(
            ChunkResponse(
                chunk_index=chunk["chunk_index"],
                text=chunk["text"],
                source_type=chunk["source_type"],
                source_name=chunk.get("source_name"),
                source_page=chunk.get("source_page"),
                embedding=embedding,
            )
        )

    logger.info(
        "Ingestion complete for note: %s - %s chunks",
        body.note_id,
        len(chunk_responses),
    )

    return IngestResponse(
        note_id=body.note_id,
        chunks=chunk_responses,
        chunk_count=len(chunk_responses),
        status="success",
    )


async def _fetch_and_extract_files(
    auth_header: str,
    note_id: str,
    filenames: list[str],
) -> list[dict]:
    """Fetch files from the storage service and extract text from each."""
    extractions = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        for filename in filenames:
            try:
                url = f"{STORAGE_BASE_URL}/files/{note_id}/{filename}"
                response = await client.get(
                    url,
                    headers={"Authorization": auth_header},
                )

                if response.status_code != 200:
                    logger.warning(
                        "Failed to fetch file %s: HTTP %s",
                        filename,
                        response.status_code,
                    )
                    continue

                file_bytes = response.content
                extraction = extract_text_from_bytes(file_bytes, filename)
                extractions.append(extraction)

                logger.info(
                    "Extracted %s chars from %s via %s",
                    len(extraction["extracted_text"]),
                    filename,
                    extraction["extraction_method"],
                )

            except Exception as exc:
                logger.error("Error processing file %s: %s", filename, exc)
                continue

    return extractions
