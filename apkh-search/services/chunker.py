"""
LangChain-based text chunker with overlap.
Splits note text and extracted file text into token-aware chunks with metadata.
"""

import logging
import re

import tiktoken
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

_encoder = tiktoken.get_encoding("cl100k_base")

DEFAULT_CHUNK_SIZE = 512
DEFAULT_OVERLAP = 64


def count_tokens(text: str) -> int:
    """Count tokens in a text string."""
    return len(_encoder.encode(text or ""))


def chunk_text(
    text: str,
    source_type: str = "note",
    source_name: str | None = None,
    source_page: int | None = None,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> list[dict]:
    """Split a single text source into LangChain chunks with source metadata."""
    if not text or not text.strip():
        return []

    metadata = {
        "source_type": source_type,
        "_source_id": _source_id(source_type, source_name, source_page, 0),
        "_source_text": text,
    }
    if source_name:
        metadata["source_name"] = source_name
    if source_page is not None:
        metadata["source_page"] = source_page

    source_docs = [Document(page_content=text, metadata=metadata)]
    return _split_source_documents(source_docs, chunk_size=chunk_size, overlap=overlap)


def chunk_document(note_text: str, file_extractions: list[dict]) -> list[dict]:
    """Chunk note content and all extracted file contents."""
    source_docs: list[Document] = []
    source_index = 0

    if note_text and note_text.strip():
        source_docs.append(
            Document(
                page_content=note_text,
                metadata={
                    "source_type": "note",
                    "_source_id": _source_id("note", None, None, source_index),
                    "_source_text": note_text,
                },
            )
        )
        source_index += 1

    for extraction in file_extractions:
        file_text = (extraction.get("extracted_text") or "").strip()
        file_name = extraction.get("file_name") or "unknown"

        if not file_text:
            continue

        pages = _split_by_pages(file_text)
        if pages:
            for page_num, page_text in pages:
                source_docs.append(
                    Document(
                        page_content=page_text,
                        metadata={
                            "source_type": "file",
                            "source_name": file_name,
                            "source_page": page_num,
                            "_source_id": _source_id("file", file_name, page_num, source_index),
                            "_source_text": page_text,
                        },
                    )
                )
                source_index += 1
            continue

        source_docs.append(
            Document(
                page_content=file_text,
                metadata={
                    "source_type": "file",
                    "source_name": file_name,
                    "_source_id": _source_id("file", file_name, None, source_index),
                    "_source_text": file_text,
                },
            )
        )
        source_index += 1

    if not source_docs:
        return []

    return _split_source_documents(source_docs)


def _split_source_documents(
    source_docs: list[Document],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> list[dict]:
    splitter = _build_splitter(chunk_size=chunk_size, overlap=overlap)
    split_docs = splitter.split_documents(source_docs)

    cursor_by_source: dict[str, int] = {}
    chunks: list[dict] = []

    for split_doc in split_docs:
        text = (split_doc.page_content or "").strip()
        if not text:
            continue

        metadata = split_doc.metadata or {}
        source_key = str(metadata.get("_source_id") or "unknown")
        source_text = str(metadata.get("_source_text") or "")

        char_start = metadata.get("start_index")
        if not isinstance(char_start, int):
            char_start = _infer_start_index(
                source_text=source_text,
                chunk_text=text,
                cursor=cursor_by_source.get(source_key, 0),
            )

        cursor_by_source[source_key] = max(char_start + len(text), cursor_by_source.get(source_key, 0))

        chunk = {
            "chunk_index": len(chunks),
            "text": text,
            "source_type": metadata.get("source_type", "note"),
            "char_start": char_start,
            "char_end": char_start + len(text),
        }
        if metadata.get("source_name"):
            chunk["source_name"] = metadata["source_name"]
        if metadata.get("source_page") is not None:
            chunk["source_page"] = metadata["source_page"]
        chunks.append(chunk)

    return chunks


def _build_splitter(chunk_size: int, overlap: int) -> RecursiveCharacterTextSplitter:
    base_kwargs = {
        "encoding_name": "cl100k_base",
        "chunk_size": chunk_size,
        "chunk_overlap": overlap,
        "separators": ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
        "strip_whitespace": True,
    }
    try:
        return RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            **base_kwargs,
            add_start_index=True,
        )
    except TypeError:
        logger.warning(
            "LangChain splitter does not support add_start_index; using inferred positions."
        )
        return RecursiveCharacterTextSplitter.from_tiktoken_encoder(**base_kwargs)


def _source_id(
    source_type: str,
    source_name: str | None,
    source_page: int | None,
    source_index: int,
) -> str:
    return f"{source_type}|{source_name or ''}|{source_page if source_page is not None else ''}|{source_index}"


def _infer_start_index(source_text: str, chunk_text: str, cursor: int) -> int:
    if not source_text:
        return max(cursor, 0)

    found = source_text.find(chunk_text, max(cursor, 0))
    if found >= 0:
        return found

    # Fallback when whitespace normalization changes exact matching.
    normalized_chunk = chunk_text.strip()
    if normalized_chunk:
        found = source_text.find(normalized_chunk, max(cursor, 0))
        if found >= 0:
            return found

    return max(cursor, 0)


def _split_by_pages(text: str) -> list[tuple[int, str]]:
    """Split PDF text that has [Page N] markers into (page_num, page_text) tuples."""
    pages: list[tuple[int, str]] = []
    parts = re.split(r"\[Page (\d+)\]\n?", text)
    i = 1
    while i < len(parts) - 1:
        page_num = int(parts[i])
        page_text = parts[i + 1].strip()
        if page_text:
            pages.append((page_num, page_text))
        i += 2
    return pages
