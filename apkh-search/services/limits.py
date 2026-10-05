"""
Request size limits, so one oversized request can't exhaust the service's
memory. FastAPI rejects anything larger with 422 before a handler runs.

Each can be raised with an env variable of the same name.
"""

import os


def _limit(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


# A note's HTML, a chat transcript, or one attachment's extracted text
MAX_TEXT_CHARS = _limit("MAX_TEXT_CHARS", 5_000_000)
# Attachments read or chunked in one request
MAX_FILES = _limit("MAX_FILES", 50)
# Size of one downloaded attachment (matches the storage service's upload limit)
MAX_FILE_BYTES = _limit("MAX_FILE_BYTES", 50 * 1024 * 1024)
# Texts embedded in one request (apkh-api sends at most 256), and their length
MAX_EMBED_TEXTS = _limit("MAX_EMBED_TEXTS", 512)
MAX_EMBED_TEXT_CHARS = _limit("MAX_EMBED_TEXT_CHARS", 32_000)
# A question or search query
MAX_QUERY_CHARS = _limit("MAX_QUERY_CHARS", 8_000)
# Retrieved passages sent with a question, and their length
MAX_CONTEXTS = _limit("MAX_CONTEXTS", 64)
MAX_CONTEXT_CHARS = _limit("MAX_CONTEXT_CHARS", 40_000)
# Previous chat messages sent with a question, and their length
MAX_HISTORY = _limit("MAX_HISTORY", 50)
MAX_MESSAGE_CHARS = _limit("MAX_MESSAGE_CHARS", 40_000)
# Short identifiers: model ids, API keys, note ids, file names
MAX_ID_CHARS = 1_000
