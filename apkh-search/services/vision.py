"""
Image reading with the user's own multimodal model.

Builds an ImageReader bound to one request's credentials. Results are cached
in memory by image hash + model, so re-saving a note does not re-send every
attachment to the provider.
"""

import asyncio
import hashlib
import logging
from collections import OrderedDict

from services.file_extractor import ImageReader
from services.llm import extract_image_content, supports_vision

logger = logging.getLogger(__name__)

VISION_CONCURRENCY = 4
CACHE_MAX_ENTRIES = 512

_cache: OrderedDict[str, str] = OrderedDict()


def build_image_reader(
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> ImageReader | None:
    """Return an ImageReader for the model, or None if it cannot take images."""
    if not supports_vision(model):
        return None

    semaphore = asyncio.Semaphore(VISION_CONCURRENCY)

    async def read_image(image: bytes, mime_type: str) -> str:
        key = f"{model.strip()}:{hashlib.sha256(image).hexdigest()}"
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            logger.info("Vision cache hit for %s", key[-12:])
            return cached

        async with semaphore:
            text = await extract_image_content(
                image,
                mime_type,
                api_key,
                model,
                user_id=user_id,
                request_id=request_id,
            )

        if text.strip():
            _cache[key] = text
            if len(_cache) > CACHE_MAX_ENTRIES:
                _cache.popitem(last=False)
        return text

    return read_image
