"""
Speech to text, for voice notes and audio attachments.

Builds an AudioReader bound to one request's credentials, like vision.py does
for images:
  - OpenAI keys use OpenAI's transcription model (OPENAI_TRANSCRIBE_MODEL)
  - Gemini keys send the audio to the user's Gemini model
  - everyone else (built-in AI, Claude, Claude Code, OpenRouter) uses a local
    Whisper model when faster-whisper is installed on this server
    (pip install faster-whisper; WHISPER_MODEL, LOCAL_TRANSCRIBE=off to disable)
Returns None when nothing here can transcribe, so callers can say so.
"""

import asyncio
import hashlib
import importlib.util
import io
import logging
import os
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from services.llm import detect_provider

logger = logging.getLogger(__name__)

# Turns audio bytes + file name into a transcript.
AudioReader = Callable[[bytes, str], Awaitable[str]]

AUDIO_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
}
AUDIO_EXTENSIONS = tuple(AUDIO_MIME_TYPES)

OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
LOCAL_TRANSCRIBE = os.getenv("LOCAL_TRANSCRIBE", "on").strip().lower() not in ("off", "false", "0")

_GEMINI_PROMPT = (
    "Transcribe this recording word for word in its original language. "
    "Start a new paragraph when the speaker or topic changes. "
    "Reply with the transcript only; if nobody speaks, reply with nothing."
)

CACHE_MAX_ENTRIES = 128
_cache: OrderedDict[str, str] = OrderedDict()

_whisper = None
# One local transcription at a time: Whisper uses every CPU core it gets.
_whisper_lock = asyncio.Lock()


@dataclass
class TranscribeUsage:
    """Provider tokens spent by one request's transcriptions."""

    tokens_used: int = 0


def audio_mime_type(file_name: str) -> str:
    return AUDIO_MIME_TYPES.get(Path(file_name).suffix.lower(), "application/octet-stream")


def local_whisper_available() -> bool:
    return LOCAL_TRANSCRIBE and importlib.util.find_spec("faster_whisper") is not None


def build_audio_reader(
    api_key: str,
    model: str,
    usage: TranscribeUsage | None = None,
) -> AudioReader | None:
    """An AudioReader for the user's provider, or None when nothing can transcribe."""
    try:
        provider = detect_provider(model)
    except ValueError:
        provider = ""
    key = (api_key or "").strip()

    if provider == "openai" and key:
        transcribe, label = _openai_transcriber(key), f"openai:{OPENAI_TRANSCRIBE_MODEL}"
    elif provider == "gemini" and key:
        transcribe, label = _gemini_transcriber(key, model.strip(), usage), f"gemini:{model.strip()}"
    elif local_whisper_available():
        transcribe, label = _local_transcribe, f"whisper:{WHISPER_MODEL}"
    else:
        return None

    async def read_audio(audio: bytes, file_name: str) -> str:
        cache_key = f"{label}:{hashlib.sha256(audio).hexdigest()}"
        cached = _cache.get(cache_key)
        if cached is not None:
            _cache.move_to_end(cache_key)
            return cached
        text = (await transcribe(audio, file_name)).strip()
        if text:
            _cache[cache_key] = text
            if len(_cache) > CACHE_MAX_ENTRIES:
                _cache.popitem(last=False)
        return text

    return read_audio


def _openai_transcriber(api_key: str) -> AudioReader:
    async def transcribe(audio: bytes, file_name: str) -> str:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
        result = await client.audio.transcriptions.create(
            model=OPENAI_TRANSCRIBE_MODEL,
            file=(Path(file_name).name or "audio.webm", audio, audio_mime_type(file_name)),
        )
        return result.text or ""

    return transcribe


def _gemini_transcriber(api_key: str, model: str, usage: TranscribeUsage | None) -> AudioReader:
    async def transcribe(audio: bytes, file_name: str) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = await client.aio.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(data=audio, mime_type=audio_mime_type(file_name)),
                _GEMINI_PROMPT,
            ],
        )
        if usage is not None and response.usage_metadata:
            usage.tokens_used += response.usage_metadata.total_token_count or 0
        return response.text or ""

    return transcribe


def _load_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        logger.info("Loading local Whisper model %s (%s)", WHISPER_MODEL, WHISPER_COMPUTE_TYPE)
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type=WHISPER_COMPUTE_TYPE)
    return _whisper


async def _local_transcribe(audio: bytes, file_name: str) -> str:
    def run() -> str:
        segments, _info = _load_whisper().transcribe(io.BytesIO(audio), vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments)

    async with _whisper_lock:
        return await asyncio.to_thread(run)
