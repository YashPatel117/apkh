"""
The AI providers, in one place: how a model id maps to its provider, and what
each provider can do. llm.py, embedder.py, vision.py and transcriber.py ask
this module instead of testing provider names themselves, so adding a provider
means adding one entry here (and its counterpart in apkh-api's
src/users/providers.ts).

Matching order matters: the built-in id and Claude Code ("claude-code:<model>")
come before Anthropic ("claude-*"), and OpenRouter ("author/model") before the
native providers, whose ids never contain a "/".
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from services import builtin_ai, claude_code

# OpenRouter speaks the OpenAI API, so the OpenAI client is pointed at it.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_HEADERS = {"X-Title": "AI-Powered Personal Knowledge Hub"}

# Models the supported providers serve without image input.
_TEXT_ONLY_MODEL_PREFIXES = ("gpt-3.5", "o1-mini", "o1-preview", "o3-mini")


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    # Recognises the provider's model ids (lower-cased, trimmed).
    matches: Callable[[str], bool]
    # (api_key, model, temperature) -> a LangChain chat model
    build_chat: Callable[[str, str, float], Any]
    # Whether the given model accepts images (OCR, image descriptions).
    reads_images: Callable[[str], bool]
    # False when it works without the user's key (built-in AI; Claude Code logs in by itself).
    needs_key: bool = True
    # Its own embedding model (the space's model id), or None (Claude: the API
    # sends its embedding calls to the built-in AI instead).
    embedding_model: str | None = None
    # Calls wait for a slot of the built-in AI's priority gate.
    queued: bool = False


def _not_text_only(model: str) -> bool:
    return model != "gpt-4" and not model.startswith(_TEXT_ONLY_MODEL_PREFIXES)


def _builtin_chat(_api_key: str, _model: str, temperature: float) -> Any:
    return ChatOpenAI(
        model=builtin_ai.chat_model(),
        api_key=builtin_ai.api_key(),
        base_url=builtin_ai.base_url(),
        # No thinking: a small model on a CPU can't spare the time, and the
        # prompts ask for direct answers.
        reasoning_effort="none",
        temperature=temperature,
        stream_usage=True,
    )


def _openrouter_chat(api_key: str, model: str, temperature: float) -> Any:
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        default_headers=OPENROUTER_HEADERS,
        temperature=temperature,
        stream_usage=True,
    )


PROVIDERS: tuple[Provider, ...] = (
    Provider(
        id="builtin",
        label="Built-in AI",
        matches=builtin_ai.is_builtin_model,
        build_chat=_builtin_chat,
        reads_images=lambda _model: builtin_ai.reads_images(),
        needs_key=False,
        embedding_model="qwen3-embedding-0.6b",
        queued=True,
    ),
    Provider(
        id="claude-code",
        label="Claude Code",
        matches=claude_code.is_claude_code_model,
        build_chat=lambda key, model, _t: claude_code.ChatClaudeCode(model=model, token=key or ""),
        reads_images=lambda _model: True,
        needs_key=False,
    ),
    Provider(
        id="openrouter",
        label="OpenRouter",
        matches=lambda m: "/" in m,
        build_chat=_openrouter_chat,
        # A static guess; vision.py asks OpenRouter's model list for the real answer.
        reads_images=_not_text_only,
        # OpenAI's model through OpenRouter: the same space as OpenAI keys.
        embedding_model="text-embedding-3-small",
    ),
    Provider(
        id="gemini",
        label="Google Gemini",
        matches=lambda m: m.startswith("gemini"),
        build_chat=lambda key, model, t: ChatGoogleGenerativeAI(
            model=model, google_api_key=key, temperature=t
        ),
        reads_images=_not_text_only,
        embedding_model="gemini-embedding-001",
    ),
    Provider(
        id="openai",
        label="OpenAI",
        # gpt-*, chatgpt-* and the o-series (o1, o3, o4-mini, ...)
        matches=lambda m: m.startswith(("gpt", "chatgpt")) or re.match(r"o\d", m) is not None,
        build_chat=lambda key, model, t: ChatOpenAI(
            model=model, api_key=key, temperature=t, stream_usage=True
        ),
        reads_images=_not_text_only,
        embedding_model="text-embedding-3-small",
    ),
    Provider(
        id="anthropic",
        label="Anthropic",
        matches=lambda m: m.startswith("claude"),
        # The SDK's default output budget cuts long answers short.
        build_chat=lambda key, model, t: ChatAnthropic(
            model=model, api_key=key, max_tokens=2048, temperature=t
        ),
        reads_images=_not_text_only,
    ),
)

_BY_ID = {provider.id: provider for provider in PROVIDERS}


def provider_for_model(model: str) -> Provider:
    """The provider serving a model id. Raises ValueError for an unrecognised one."""
    normalized = (model or "").strip().lower()
    for provider in PROVIDERS:
        if normalized and provider.matches(normalized):
            return provider
    raise ValueError(
        f"Cannot detect provider for model '{model}'. "
        "Use an OpenRouter 'author/model' id, a 'claude-code:<model>' id, or a model starting "
        "with 'gemini-', 'gpt-', 'chatgpt-', 'o<N>' or 'claude-'."
    )


def get(provider_id: str) -> Provider:
    try:
        return _BY_ID[provider_id]
    except KeyError:
        raise ValueError(f"Unknown provider '{provider_id}'.") from None


def detect_provider(model: str) -> str:
    """The provider id for a model id. Raises ValueError for an unrecognised one."""
    return provider_for_model(model).id


def is_openrouter_model(model: str) -> bool:
    """OpenRouter ids are "author/model"; Gemini, OpenAI and Claude ids never contain "/"."""
    return "/" in (model or "").strip()


def has_credentials(api_key: str | None, model: str | None) -> bool:
    """A known model, plus the user's key unless its provider needs none."""
    try:
        provider = provider_for_model(model or "")
    except ValueError:
        # Unknown ids still count when a key came with them; the call itself reports the model.
        return bool((model or "").strip()) and bool((api_key or "").strip())
    return not provider.needs_key or bool((api_key or "").strip())


def supports_vision(model: str) -> bool:
    """Whether the model accepts images (used for OCR and image descriptions)."""
    normalized = (model or "").strip().lower()
    try:
        return provider_for_model(normalized).reads_images(normalized)
    except ValueError:
        return _not_text_only(normalized)
