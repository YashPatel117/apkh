"""
Transcribe one recording on request (voice notes recorded in the editor).
Attachments are transcribed while indexing instead (/ingest/extract).
"""

import base64
import binascii
import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.limits import MAX_ID_CHARS
from services.llm import provider_error_message
from services.transcriber import TranscribeUsage, build_audio_reader

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Transcription"])

# Same as the API's upload limit for one recording (and OpenAI's 25 MB cap).
MAX_AUDIO_BYTES = 20 * 1024 * 1024

Id = Annotated[str, Field(max_length=MAX_ID_CHARS)]


class TranscribeRequest(BaseModel):
    # Base64 of the recording
    audio: Annotated[str, Field(max_length=MAX_AUDIO_BYTES * 4 // 3 + 8)]
    file_name: Id
    api_key: Id = ""
    model: Id


class TranscribeResponse(BaseModel):
    # False: nothing on this server can transcribe for the user's provider
    available: bool
    text: str = ""
    tokens_used: int = 0


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(body: TranscribeRequest):
    usage = TranscribeUsage()
    read_audio = build_audio_reader(body.api_key, body.model, usage=usage)
    if read_audio is None:
        return TranscribeResponse(available=False)

    try:
        audio = base64.b64decode(body.audio, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The recording is not valid base64.")
    if not audio:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Recordings can be at most 20 MB.")

    try:
        text = await read_audio(audio, body.file_name)
    except Exception as exc:
        logger.warning("Transcribing %s with %s failed: %s", body.file_name, body.model, exc)
        raise HTTPException(status_code=502, detail=provider_error_message(exc))
    return TranscribeResponse(available=True, text=text, tokens_used=usage.tokens_used)
