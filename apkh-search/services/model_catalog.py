"""
Live model discovery.

Asks the provider which models an API key can use, so the model picker
follows the provider as models are released and retired instead of relying on
a hardcoded list.
"""

import logging
import re

import httpx

logger = logging.getLogger(__name__)

PROVIDERS = ("gemini", "openai", "anthropic")
REQUEST_TIMEOUT = 15.0

GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"
OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"

# Every model the key can use is listed, not only chat models: picking one that
# can't answer text chat (speech, image, embeddings…) fails when it's asked.
# Dated snapshots duplicate their alias (gpt-4o-2024-08-06, gpt-4-0613).
_OPENAI_SNAPSHOT = re.compile(r"-\d{4}(-\d{2}-\d{2})?(-preview)?$")


class ModelListError(Exception):
    """The provider could not be reached or rejected the API key."""


async def list_chat_models(provider: str, api_key: str) -> list[dict[str, str]]:
    """Return [{id, label}] for the models the key can use, newest first."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        if provider == "gemini":
            return await _list_gemini(client, api_key)
        if provider == "openai":
            return await _list_openai(client, api_key)
        if provider == "anthropic":
            return await _list_anthropic(client, api_key)
    raise ValueError(f"Unknown provider '{provider}'.")


async def _list_gemini(client: httpx.AsyncClient, api_key: str) -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    params: dict[str, str | int] = {"pageSize": 1000}

    while True:
        data = await _get_json(client, GEMINI_MODELS_URL, {"x-goog-api-key": api_key}, params)
        for model in data.get("models", []):
            model_id = str(model.get("name", "")).removeprefix("models/")
            # generateContent is the only call the app makes to Gemini
            if "generateContent" in model.get("supportedGenerationMethods", []):
                models.append({"id": model_id, "label": model.get("displayName") or model_id})

        page_token = data.get("nextPageToken")
        if not page_token:
            break
        params["pageToken"] = page_token

    return sorted(models, key=lambda model: _gemini_sort_key(model["id"]))


def _gemini_sort_key(model_id: str) -> tuple:
    """'-latest' aliases first, then newest version, stable before preview."""
    version = re.search(r"gemini-(\d+(?:\.\d+)*)", model_id)
    newest_first = tuple(-int(part) for part in version.group(1).split(".")) if version else (0,)
    return (
        "latest" not in model_id,
        newest_first,
        "preview" in model_id or "exp" in model_id,
        model_id,
    )


async def _list_openai(client: httpx.AsyncClient, api_key: str) -> list[dict[str, str]]:
    data = await _get_json(client, OPENAI_MODELS_URL, {"Authorization": f"Bearer {api_key}"})
    models = [
        model for model in data.get("data", [])
        if model.get("id") and not _OPENAI_SNAPSHOT.search(str(model["id"]))
    ]
    models.sort(key=lambda model: model.get("created", 0), reverse=True)
    return [{"id": model["id"], "label": model["id"]} for model in models]


async def _list_anthropic(client: httpx.AsyncClient, api_key: str) -> list[dict[str, str]]:
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    models: list[dict[str, str]] = []
    params: dict[str, str | int] = {"limit": 1000}

    # The API returns the newest models first.
    while True:
        data = await _get_json(client, ANTHROPIC_MODELS_URL, headers, params)
        for model in data.get("data", []):
            model_id = str(model.get("id", ""))
            if model_id:
                models.append({"id": model_id, "label": model.get("display_name") or model_id})

        if not data.get("has_more") or not data.get("last_id"):
            break
        params["after_id"] = data["last_id"]

    return models


async def _get_json(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    params: dict[str, str | int] | None = None,
) -> dict:
    try:
        response = await client.get(url, headers=headers, params=params)
    except httpx.HTTPError as exc:
        logger.warning("Model list request to %s failed: %s", url, exc)
        raise ModelListError("Could not reach the provider. Try again in a moment.") from exc

    if response.status_code != 200:
        raise ModelListError(_provider_error_message(response))

    data = response.json()
    return data if isinstance(data, dict) else {}


def _provider_error_message(response: httpx.Response) -> str:
    """All three providers return {"error": {"message": ...}} on failure."""
    try:
        body = response.json()
    except ValueError:
        body = None

    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict) and isinstance(error.get("message"), str) and error["message"].strip():
        return error["message"].strip()

    if response.status_code in (401, 403):
        return "The provider rejected this API key."
    return f"The provider returned HTTP {response.status_code}."
