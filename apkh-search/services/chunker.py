"""
Text chunker with overlap.
Splits combined document text into overlapping chunks for embedding.
Sentence-aware splitting to avoid cutting mid-sentence.
"""

import logging
import tiktoken

logger = logging.getLogger(__name__)

# Use cl100k_base tokenizer (same family as Gemini/GPT models)
_encoder = tiktoken.get_encoding("cl100k_base")

DEFAULT_CHUNK_SIZE = 512    # tokens
DEFAULT_OVERLAP = 64        # tokens


def count_tokens(text: str) -> int:
    """Count tokens in a text string."""
    return len(_encoder.encode(text))


def chunk_text(
    text: str,
    source_type: str = "note",
    source_name: str | None = None,
    source_page: int | None = None,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> list[dict]:
    """
    Split text into overlapping chunks with metadata.

    Args:
        text: The text to chunk
        source_type: "note" or "file"
        source_name: filename if source_type is "file"
        source_page: page number if PDF
        chunk_size: max tokens per chunk
        overlap: token overlap between chunks

    Returns:
        List of chunk dicts with text and metadata
    """
    if not text or not text.strip():
        return []

    # Split into sentences first
    sentences = _split_into_sentences(text)

    chunks = []
    current_chunk_sentences = []
    current_token_count = 0
    char_offset = 0

    for sentence in sentences:
        sentence_tokens = count_tokens(sentence)

        # If a single sentence exceeds chunk size, force-split it
        if sentence_tokens > chunk_size:
            # Flush current chunk first
            if current_chunk_sentences:
                chunk_text_str = " ".join(current_chunk_sentences)
                chunks.append(_make_chunk(
                    chunk_text_str, len(chunks), source_type,
                    source_name, source_page, char_offset
                ))
                # Keep overlap
                current_chunk_sentences, current_token_count, char_offset = \
                    _keep_overlap(current_chunk_sentences, overlap, char_offset)

            # Split the long sentence by tokens
            long_chunks = _force_split_by_tokens(sentence, chunk_size, overlap)
            for lc in long_chunks:
                chunks.append(_make_chunk(
                    lc, len(chunks), source_type,
                    source_name, source_page, char_offset
                ))
                char_offset += len(lc)
            continue

        # Would adding this sentence exceed chunk size?
        if current_token_count + sentence_tokens > chunk_size and current_chunk_sentences:
            # Flush current chunk
            chunk_text_str = " ".join(current_chunk_sentences)
            chunks.append(_make_chunk(
                chunk_text_str, len(chunks), source_type,
                source_name, source_page, char_offset
            ))
            # Keep overlap sentences
            current_chunk_sentences, current_token_count, char_offset = \
                _keep_overlap(current_chunk_sentences, overlap, char_offset)

        current_chunk_sentences.append(sentence)
        current_token_count += sentence_tokens

    # Flush remaining
    if current_chunk_sentences:
        chunk_text_str = " ".join(current_chunk_sentences)
        chunks.append(_make_chunk(
            chunk_text_str, len(chunks), source_type,
            source_name, source_page, char_offset
        ))

    return chunks


def chunk_document(note_text: str, file_extractions: list[dict]) -> list[dict]:
    """
    Chunk the entire document: note text + all file extractions.

    Args:
        note_text: Plain text from the note body
        file_extractions: List of extraction results from file_extractor

    Returns:
        Combined list of all chunks with proper metadata
    """
    all_chunks = []

    # Chunk the note text
    if note_text and note_text.strip():
        note_chunks = chunk_text(
            text=note_text,
            source_type="note",
        )
        all_chunks.extend(note_chunks)

    # Chunk each file's extracted text
    for extraction in file_extractions:
        file_text = extraction.get("extracted_text", "")
        file_name = extraction.get("file_name", "unknown")

        if not file_text or not file_text.strip():
            continue

        # For PDFs, chunk per page if page markers exist
        if "[Page " in file_text:
            pages = _split_by_pages(file_text)
            for page_num, page_text in pages:
                page_chunks = chunk_text(
                    text=page_text,
                    source_type="file",
                    source_name=file_name,
                    source_page=page_num,
                )
                all_chunks.extend(page_chunks)
        else:
            file_chunks = chunk_text(
                text=file_text,
                source_type="file",
                source_name=file_name,
            )
            all_chunks.extend(file_chunks)

    # Re-index chunk_index across all chunks
    for i, chunk in enumerate(all_chunks):
        chunk["chunk_index"] = i

    return all_chunks


def _split_into_sentences(text: str) -> list[str]:
    """Simple sentence splitting by period, newline, etc."""
    import re
    # Split on sentence-ending punctuation followed by whitespace, or on newlines
    parts = re.split(r'(?<=[.!?])\s+|\n+', text)
    return [p.strip() for p in parts if p.strip()]


def _make_chunk(
    text: str,
    chunk_index: int,
    source_type: str,
    source_name: str | None,
    source_page: int | None,
    char_start: int,
) -> dict:
    """Create a chunk metadata dict."""
    chunk = {
        "chunk_index": chunk_index,
        "text": text,
        "source_type": source_type,
        "char_start": char_start,
        "char_end": char_start + len(text),
    }
    if source_name:
        chunk["source_name"] = source_name
    if source_page is not None:
        chunk["source_page"] = source_page
    return chunk


def _keep_overlap(sentences: list[str], overlap_tokens: int, char_offset: int):
    """Keep the last N tokens worth of sentences for overlap."""
    kept = []
    token_count = 0
    for s in reversed(sentences):
        s_tokens = count_tokens(s)
        if token_count + s_tokens > overlap_tokens:
            break
        kept.insert(0, s)
        token_count += s_tokens

    # Update char_offset
    if kept:
        overlap_text = " ".join(sentences[:-len(kept)] if len(kept) < len(sentences) else [])
        char_offset += len(overlap_text) + (1 if overlap_text else 0)

    return kept, token_count, char_offset


def _force_split_by_tokens(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Force-split a very long text by token boundaries."""
    tokens = _encoder.encode(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append(_encoder.decode(chunk_tokens))
        start = end - overlap if end < len(tokens) else end
    return chunks


def _split_by_pages(text: str) -> list[tuple[int, str]]:
    """Split PDF text that has [Page N] markers into (page_num, page_text) tuples."""
    import re
    pages = []
    parts = re.split(r'\[Page (\d+)\]\n?', text)

    # parts = ['', '1', 'page 1 text...', '2', 'page 2 text...', ...]
    i = 1
    while i < len(parts) - 1:
        page_num = int(parts[i])
        page_text = parts[i + 1].strip()
        if page_text:
            pages.append((page_num, page_text))
        i += 2

    return pages
