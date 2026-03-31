"""
Ingestion endpoint.
Receives note data, processes content + files, generates chunks & embeddings.
"""

import logging
import httpx
from fastapi import APIRouter, Request, HTTPException, status
from pydantic import BaseModel

from services.html_parser import parse_note_html
from services.file_extractor import extract_text_from_bytes
from services.chunker import chunk_document
from services.embedder import generate_embeddings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["Ingestion"])

STORAGE_BASE_URL = "http://localhost:3001"


class IngestRequest(BaseModel):
    note_id: str
    user_id: str
    title: str
    content: str        # Quill HTML
    files: list[str] = []  # list of filenames


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
    1. Parse HTML → plain text + file tokens
    2. Fetch & extract text from attached files
    3. Chunk the combined text
    4. Generate embeddings via Gemini
    5. Return chunks + embeddings
    """
    logger.info(f"Ingestion started for note: {body.note_id}")

    # Get auth token from the request (forwarded from API module)
    auth_header = request.headers.get("Authorization", "")

    # Step 1: Parse note HTML
    parsed = parse_note_html(body.content)
    logger.info(f"Parsed note: {len(parsed.text_content)} chars text, "
                f"{len(parsed.file_tokens)} file tokens, "
                f"{len(parsed.links)} links")

    # Build note text with links appended
    note_text = parsed.text_content
    if parsed.links:
        link_lines = [f"  - {l['text']} ({l['href']})" for l in parsed.links]
        note_text += "\n\nLinks:\n" + "\n".join(link_lines)

    # Step 2 & 3: Fetch files and extract text
    file_extractions = []
    if body.files:
        file_extractions = await _fetch_and_extract_files(
            auth_header, body.note_id, body.files
        )
        logger.info(f"Extracted text from {len(file_extractions)} files")

    # Step 4: Chunk everything
    chunks = chunk_document(note_text, file_extractions)
    logger.info(f"Created {len(chunks)} chunks")

    if not chunks:
        # If no meaningful content, create a minimal chunk with just the title
        chunks = [{
            "chunk_index": 0,
            "text": body.title,
            "source_type": "note",
            "char_start": 0,
            "char_end": len(body.title),
        }]

    # Step 5: Generate embeddings
    texts_to_embed = [c["text"] for c in chunks]
    embeddings = await generate_embeddings(texts_to_embed)
    logger.info(f"Generated {len(embeddings)} embeddings")

    # Step 6: Compose response
    chunk_responses = []
    for chunk, embedding in zip(chunks, embeddings):
        chunk_responses.append(ChunkResponse(
            chunk_index=chunk["chunk_index"],
            text=chunk["text"],
            source_type=chunk["source_type"],
            source_name=chunk.get("source_name"),
            source_page=chunk.get("source_page"),
            embedding=embedding,
        ))

    logger.info(f"Ingestion complete for note: {body.note_id} — {len(chunk_responses)} chunks")

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
                    headers={"Authorization": auth_header}
                )

                if response.status_code != 200:
                    logger.warning(f"Failed to fetch file {filename}: HTTP {response.status_code}")
                    continue

                file_bytes = response.content
                extraction = extract_text_from_bytes(file_bytes, filename)
                extractions.append(extraction)

                logger.info(f"Extracted {len(extraction['extracted_text'])} chars "
                            f"from {filename} via {extraction['extraction_method']}")

            except Exception as e:
                logger.error(f"Error processing file {filename}: {e}")
                continue

    return extractions
