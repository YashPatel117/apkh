"""Server-sent events: streamed answers go to apkh-api as `data: <json>` lines."""

import json
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse


def event_stream(events: AsyncIterator[dict], **extra) -> StreamingResponse:
    """Each event becomes one SSE message; `extra` is added to the final "done" event."""

    async def body():
        async for event in events:
            if event.get("type") == "done":
                event = {**event, **extra}
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        # No proxy buffering: each token should reach the browser as it is written.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
