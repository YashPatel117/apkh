"""
File content extractor.
Handles PDF, images, docx, xlsx, csv, txt, md files.
Extracts text content for embedding. Images and scanned PDF pages are read by
the user's own multimodal model (OCR + description) through an ImageReader.
"""

import asyncio
import csv
import io
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Turns image bytes + MIME type into searchable text (transcription + description).
ImageReader = Callable[[bytes, str], Awaitable[str]]

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff")

# PDF pages with less extractable text than this are treated as scanned.
MIN_PDF_PAGE_TEXT = 50
MAX_VISION_PAGES_PER_PDF = 100
PDF_RENDER_DPI = 150

# Longest image side sent to the model; providers downscale beyond this anyway.
MAX_IMAGE_SIDE = 2000
# Keeps the base64 payload under the strictest provider limit (Anthropic, 5 MB).
MAX_IMAGE_BYTES = 3_500_000


async def extract_text_from_bytes(
    file_bytes: bytes,
    file_name: str,
    read_image: ImageReader | None = None,
) -> dict:
    """
    Extract text from file bytes based on file extension.
    Returns a dict with extracted_text, extraction_method, page_count.
    Without read_image, images are skipped and scanned PDF pages stay empty.
    """
    ext = Path(file_name).suffix.lower()

    try:
        if ext == ".pdf":
            return await _extract_pdf(file_bytes, file_name, read_image)
        elif ext in IMAGE_EXTENSIONS:
            return await _extract_image(file_bytes, file_name, read_image)
        elif ext in (".txt", ".md"):
            return await asyncio.to_thread(_extract_text_file, file_bytes, file_name)
        elif ext == ".docx":
            return await asyncio.to_thread(_extract_docx, file_bytes, file_name)
        elif ext in (".xlsx", ".csv"):
            return await asyncio.to_thread(_extract_spreadsheet, file_bytes, file_name, ext)
        else:
            logger.warning(f"Unsupported file type: {ext} for file {file_name}")
            return {
                "file_name": file_name,
                "extracted_text": "",
                "extraction_method": "unsupported",
                "page_count": 0,
            }
    except Exception as e:
        logger.error(f"Error extracting text from {file_name}: {e}")
        return {
            "file_name": file_name,
            "extracted_text": "",
            "extraction_method": "error",
            "page_count": 0,
        }


async def _extract_pdf(
    file_bytes: bytes,
    file_name: str,
    read_image: ImageReader | None,
) -> dict:
    """Extract text from PDF. Scanned pages are read by the vision model."""
    pages, page_count = await asyncio.to_thread(
        _read_pdf_pages,
        file_bytes,
        file_name,
        read_image is not None,
    )

    async def _page_text(page_num: int, text: str, image: bytes | None) -> tuple[str, bool]:
        if image is None or read_image is None:
            return text, False
        try:
            vision_text = (await read_image(image, "image/jpeg")).strip()
        except Exception as e:
            logger.warning(f"Vision read failed on page {page_num} of {file_name}: {e}")
            return text, False
        return (vision_text, True) if vision_text else (text, False)

    results = await asyncio.gather(
        *[_page_text(page_num, text, image) for page_num, text, image in pages]
    )

    pages_text = [
        f"[Page {page_num}]\n{text}"
        for (page_num, _, _), (text, _) in zip(pages, results)
        if text
    ]
    used_vision = any(read for _, read in results)

    return {
        "file_name": file_name,
        "extracted_text": "\n\n".join(pages_text),
        "extraction_method": "pdf_vision" if used_vision else "pdf_text",
        "page_count": page_count,
    }


def _read_pdf_pages(
    file_bytes: bytes,
    file_name: str,
    render_scanned: bool,
) -> tuple[list[tuple[int, str, bytes | None]], int]:
    """
    Return (page_num, text, rendered JPEG or None) per page, plus the page count.
    Pages with too little text are rendered so the vision model can read them.
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        pages: list[tuple[int, str, bytes | None]] = []
        rendered = 0
        skipped = 0

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            image = None

            if render_scanned and len(text) < MIN_PDF_PAGE_TEXT:
                if rendered < MAX_VISION_PAGES_PER_PDF:
                    image = _render_pdf_page(page)
                    rendered += 1
                else:
                    skipped += 1

            pages.append((page_num, text, image))

        if skipped:
            logger.warning(
                f"{file_name}: skipped vision on {skipped} scanned pages "
                f"(limit {MAX_VISION_PAGES_PER_PDF} per PDF)"
            )

        return pages, len(doc)
    finally:
        doc.close()


def _render_pdf_page(page: fitz.Page) -> bytes:
    long_side_points = max(page.rect.width, page.rect.height)
    zoom = min(PDF_RENDER_DPI / 72, MAX_IMAGE_SIDE / long_side_points)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    return pix.tobytes("jpeg", jpg_quality=85)


async def _extract_image(
    file_bytes: bytes,
    file_name: str,
    read_image: ImageReader | None,
) -> dict:
    """Transcribe and describe an image with the vision model."""
    if read_image is None:
        logger.warning(f"Active model cannot read images, skipping {file_name}")
        return {
            "file_name": file_name,
            "extracted_text": "",
            "extraction_method": "image_no_vision",
            "page_count": 0,
        }

    text = ""
    method = "image_vision"
    try:
        image, mime_type = await asyncio.to_thread(_prepare_image, file_bytes)
        text = (await read_image(image, mime_type)).strip()
    except Exception as e:
        logger.error(f"Vision read failed for {file_name}: {e}")
        method = "image_vision_failed"

    return {
        "file_name": file_name,
        "extracted_text": text,
        "extraction_method": method,
        "page_count": 0,
    }


def _prepare_image(file_bytes: bytes) -> tuple[bytes, str]:
    """
    Convert any supported image to PNG (or JPEG when too large) within the
    size limits every provider accepts. Returns (bytes, mime_type).
    """
    with Image.open(io.BytesIO(file_bytes)) as source:
        img = ImageOps.exif_transpose(source)

        # Flatten transparency onto white so dark text on a clear background stays readable.
        if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
            rgba = img.convert("RGBA")
            img = Image.new("RGB", rgba.size, "white")
            img.paste(rgba, mask=rgba.getchannel("A"))
        else:
            img = img.convert("RGB")

    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))

    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    if buffer.tell() <= MAX_IMAGE_BYTES:
        return buffer.getvalue(), "image/png"

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue(), "image/jpeg"


def _extract_text_file(file_bytes: bytes, file_name: str) -> dict:
    """Read .txt / .md files directly."""
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = file_bytes.decode("latin-1", errors="replace")

    return {
        "file_name": file_name,
        "extracted_text": text.strip(),
        "extraction_method": "direct",
        "page_count": 0,
    }


def _extract_docx(file_bytes: bytes, file_name: str) -> dict:
    """Extract text from .docx files."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    text = "\n".join(paragraphs)

    return {
        "file_name": file_name,
        "extracted_text": text,
        "extraction_method": "docx_parse",
        "page_count": 0,
    }


def _extract_spreadsheet(file_bytes: bytes, file_name: str, ext: str) -> dict:
    """Extract text from .xlsx or .csv files."""
    import openpyxl

    text_parts = []

    if ext == ".xlsx":
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True)
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            text_parts.append(f"[Sheet: {sheet_name}]")
            for row in ws.iter_rows(values_only=True):
                row_text = " | ".join(
                    str(cell) if cell is not None else "" for cell in row
                )
                if row_text.strip() and row_text.strip() != "|":
                    text_parts.append(row_text)
        wb.close()
    elif ext == ".csv":
        content = file_bytes.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(content))
        for row in reader:
            row_text = " | ".join(row)
            if row_text.strip():
                text_parts.append(row_text)

    return {
        "file_name": file_name,
        "extracted_text": "\n".join(text_parts),
        "extraction_method": "spreadsheet_parse",
        "page_count": 0,
    }
