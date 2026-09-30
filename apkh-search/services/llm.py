"""
LLM service for answer generation using only per-request credentials.

Supported providers (detected by model name):
  - Free built-in  : the model id "free" (open-source models the host runs; see free_ai.py)
  - OpenRouter     : "author/model" ids (e.g. "qwen/qwen3.8-27b:free"); no native id has a "/"
  - Google Gemini  : model starts with "gemini-"
  - OpenAI         : model starts with "gpt-", "chatgpt-" or "o<N>" (o1, o3, o4-mini, ...)
  - Anthropic      : model starts with "claude-"
"""

import base64
import json
import logging
import re
import traceback
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from services import free_ai
from services.html_parser import parse_note_html
from services.langsmith_config import build_langchain_config

logger = logging.getLogger(__name__)

_SYSTEM_INSTRUCTION = (
    "You are a knowledge-base assistant. You answer the user's question from their own notes, "
    "which are given as numbered sources.\n\n"
    "How to answer:\n"
    "- Base the answer on the sources whenever they cover the question. After each statement "
    "taken from a source, cite it with its number in square brackets, e.g. [1] or [2][3]. Only "
    "cite numbers that appear in the sources.\n"
    "- If the sources cover the question only partly, answer that part and say what is missing.\n"
    "- If the sources don't cover the question at all, say: I couldn't find this in your notes. "
    'You may then add a short answer from general knowledge, labelled "From general knowledge:" '
    "and without citations.\n"
    "- Never invent personal details or note contents that aren't in the sources.\n"
    "- Be concise. Use bullet points for lists, steps and comparisons; skip filler."
)


_SUMMARY_SYSTEM_INSTRUCTION = (
    "You summarize one personal note at a time.\n"
    "Rules:\n"
    "- Write a compact summary that is easy to scan in the UI.\n"
    "- Focus on the main ideas, tasks, decisions, dates, and useful links.\n"
    "- Do not invent details that are not present.\n"
    "- Keep it under 120 words.\n"
    "- If the note is mostly empty, say that clearly in one short sentence."
)

_ACTIONS_SYSTEM_INSTRUCTION = (
    "You extract action items from one personal note.\n"
    "Rules:\n"
    "- Only include what the note actually says; never invent tasks, owners or dates.\n"
    "- tasks: things someone has to do. Give owner and due only when the note names them; "
    "done is true only if the note marks the task as done.\n"
    "- decisions: things that were decided or agreed.\n"
    "- deadlines: dates or times when something is due or happens, written as in the note.\n"
    "- people: people mentioned, with their role in the note when it is clear.\n"
    "- summary: one or two plain sentences on what the note is about.\n"
    "Respond with JSON only, with exactly these keys (empty lists when there is nothing):\n"
    '{"summary": "...", "tasks": [{"task": "...", "owner": null, "due": null, "done": false}], '
    '"decisions": ["..."], "deadlines": [{"what": "...", "when": "..."}], '
    '"people": [{"name": "...", "role": null}]}'
)

_CHAT_SYSTEM_INSTRUCTION = (
    "You are a helpful assistant with access to the user's personal knowledge base.\n\n"
    "Context, in order of priority:\n\n"
    "[EARLIER IN THIS CONVERSATION]\n"
    "{current_chat_chunks}\n\n"
    "[NOTES] (numbered sources)\n"
    "{notes_chunks}\n\n"
    "[RELATED PAST CONVERSATIONS]\n"
    "{similar_chat_chunks}\n\n"
    "Instructions:\n"
    "- For follow-up questions, resolve references (it, that, the second one) from this "
    "conversation first.\n"
    "- Use the NOTES as your main source of facts. After each statement taken from a note, cite "
    "it with its number in square brackets, e.g. [1] or [2][3]. Only cite numbers that appear "
    "in NOTES.\n"
    "- Use related past conversations only as supporting context, and don't cite them.\n"
    "- Be concise. If the notes don't cover something, say so; never invent personal details or "
    "note contents."
)

_IMAGE_EXTRACTION_INSTRUCTION = (
    "You turn images into searchable text for a personal knowledge base.\n"
    "Rules:\n"
    "- If the image contains readable text (documents, scans, screenshots, slides, handwriting, "
    "code, signs), transcribe ALL of it exactly as written. Keep line breaks and lists; write "
    "table rows with ' | ' between cells. Do not summarize, translate or correct it.\n"
    "- Then describe what the image shows: subject, objects, people, setting, and any diagram, "
    "chart or UI (include labels, values and trends for charts). Keep this to one or two "
    "sentences when the image is mostly text; be detailed when it has little or no text.\n"
    "- Never guess at text you cannot read and do not invent details.\n"
    "Respond in exactly this format, leaving out the Text section when there is no readable text:\n"
    "Text:\n<transcription>\n\nDescription:\n<description>"
)

_REWRITE_INSTRUCTION = (
    "You turn a user's question into a search query for their personal notes.\n"
    "Rules:\n"
    "- If a conversation is given, resolve references (it, that, the second one, he...) from it, "
    "so the query makes sense on its own.\n"
    "- Keep names, codes, numbers and quoted phrases exactly as written.\n"
    "- When the question is vague, add a few likely synonyms or related terms.\n"
    "- Do not answer the question.\n"
    'Respond with JSON only: {"query": "<standalone search query>", "keywords": ["<term>", ...]}'
)

# Models the supported providers serve without image input.
_TEXT_ONLY_MODEL_PREFIXES = ("gpt-3.5", "o1-mini", "o1-preview", "o3-mini")

# OpenRouter speaks the OpenAI API, so the OpenAI client is pointed at it.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_HEADERS = {"X-Title": "AI-Powered Personal Knowledge Hub"}


def is_openrouter_model(model: str) -> bool:
    """OpenRouter ids are "author/model"; Gemini, OpenAI and Claude ids never contain "/"."""
    return "/" in model.strip()


def has_credentials(api_key: str | None, model: str | None) -> bool:
    """A model, plus the user's key unless it is the free built-in model."""
    resolved_model = (model or "").strip()
    return bool(resolved_model) and (bool((api_key or "").strip()) or free_ai.is_free_model(resolved_model))


def detect_provider(model: str) -> str:
    """Detect provider from model name."""
    normalized = model.lower()
    if free_ai.is_free_model(normalized):
        return "free"
    if is_openrouter_model(normalized):
        return "openrouter"
    if normalized.startswith("gemini"):
        return "gemini"
    if normalized.startswith(("gpt", "chatgpt")) or re.match(r"o\d", normalized):
        return "openai"
    if normalized.startswith("claude"):
        return "anthropic"
    raise ValueError(
        f"Cannot detect provider for model '{model}'. "
        "Use an OpenRouter 'author/model' id, or a model starting with 'gemini-', 'gpt-', "
        "'chatgpt-', 'o<N>' or 'claude-'."
    )


# Longest provider error message shown to users; the raw ones can run to pages.
_MAX_ERROR_MESSAGE = 300


def provider_error_message(exc: Exception) -> str:
    """
    Turn SDK/provider exceptions into a clean, short message that can be sent to
    clients: the provider's own message, first line only.
    """
    return _first_line(_raw_provider_error_message(exc))


def _raw_provider_error_message(exc: Exception) -> str:
    response_json: Any = getattr(exc, "response_json", None)
    if isinstance(response_json, dict):
        error = response_json.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()

        message = response_json.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()

    message = str(exc).strip()
    if not message:
        return exc.__class__.__name__

    lowered = message.lower()
    if (
        "api key not found" in lowered
        or "api_key_invalid" in lowered
        or "invalid api key" in lowered
    ):
        return "API key is invalid for the selected provider/model."

    single_quoted_message = re.search(r"'message':\s*'([^']+)'", message)
    if single_quoted_message and single_quoted_message.group(1).strip():
        return single_quoted_message.group(1).strip()

    double_quoted_message = re.search(r'"message"\s*:\s*"([^"]+)"', message)
    if double_quoted_message and double_quoted_message.group(1).strip():
        return double_quoted_message.group(1).strip()

    return message


def _first_line(message: str) -> str:
    # Messages quoted from a repr carry escaped newlines ("\\n")
    line = re.split(r"\\n|\n", message, maxsplit=1)[0].strip() or message.strip()
    if len(line) > _MAX_ERROR_MESSAGE:
        line = line[: _MAX_ERROR_MESSAGE - 1].rstrip() + "…"
    return line


def _is_model_unavailable(exc: Exception) -> bool:
    """Whether the provider says the model does not exist (retired or renamed)."""
    if getattr(exc, "status_code", None) == 404 or getattr(exc, "code", None) == 404:
        return True
    message = str(exc)
    return any(marker in message for marker in ("NOT_FOUND", "model_not_found", "not_found_error"))


def _model_unavailable_message(model: str) -> str:
    return (
        f"The model '{model}' is no longer available from your provider. "
        "Choose another model in Profile → AI models."
    )


def _failure_message(provider: str, model: str, exc: Exception, default: str) -> str:
    """What to tell the user when a call to their model failed."""
    if provider == "free":
        free_ai.log_failure("chat", exc)
        return free_ai.UNAVAILABLE_MESSAGE
    if _is_model_unavailable(exc):
        return _model_unavailable_message(model)
    return default


def supports_vision(model: str) -> bool:
    """Whether the model accepts images (used for OCR and image descriptions)."""
    normalized = model.strip().lower()
    if free_ai.is_free_model(normalized):
        return free_ai.reads_images()
    return normalized != "gpt-4" and not normalized.startswith(_TEXT_ONLY_MODEL_PREFIXES)


def _chat_model(provider: str, api_key: str, model: str, temperature: float = 0.2) -> Any:
    """The LangChain chat model for a provider."""
    if provider == "free":
        return ChatOpenAI(
            model=free_ai.chat_model(),
            api_key=free_ai.api_key(),
            base_url=free_ai.base_url(),
            # No thinking: a small model on a CPU can't spare the time, and the
            # prompts ask for direct answers.
            reasoning_effort="none",
            temperature=temperature,
        )
    if provider == "gemini":
        return ChatGoogleGenerativeAI(model=model, google_api_key=api_key, temperature=temperature)
    if provider == "openai":
        return ChatOpenAI(model=model, api_key=api_key, temperature=temperature)
    if provider == "openrouter":
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            default_headers=OPENROUTER_HEADERS,
            temperature=temperature,
        )
    # The SDK's default output budget cuts long answers short.
    return ChatAnthropic(model=model, api_key=api_key, max_tokens=2048, temperature=temperature)


def _caller_for(provider: str):
    """A one-shot (system + user prompt) call to the provider's chat model."""

    async def call(
        api_key: str, model: str, system: str, user_prompt: str | list[dict[str, Any]],
        config: dict[str, Any] | None = None,
    ) -> dict:
        return await _call(provider, api_key, model, system, user_prompt, config)

    return call


async def _call(
    provider: str, api_key: str, model: str, system: str, user_prompt: str | list[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> dict:
    chat = _chat_model(provider, api_key, model)
    response = await chat.ainvoke(
        [
            SystemMessage(content=system),
            HumanMessage(content=user_prompt),
        ],
        config=config or {},
    )
    return {
        "answer": _extract_message_text(response.content),
        "tokens_used": _extract_tokens_used(response),
        "run_id": _extract_run_id(config),
    }


async def generate_rag_answer(
    query: str,
    contexts: list[str],
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    """
    Generate an answer from the provided context chunks.
    """
    if not contexts:
        return {
            "answer": "I couldn't find any relevant information in your notes.",
            "tokens_used": 0,
            "run_id": None,
        }

    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()

    if not has_credentials(resolved_key, resolved_model):
        return {
            "answer": "Add an active API key and model in profile settings to enable AI search.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    # Numbered so the answer can cite them; the API maps [n] back to contexts[n-1].
    sources = "\n\n---\n\n".join(f"[{i}] {context}" for i, context in enumerate(contexts, start=1))
    user_prompt = f"Sources:\n\n{sources}\n\n---\n\nQuestion: {query}"

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return {
            "answer": "Unsupported model. Please check your AI settings.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    trace_config = build_langchain_config(
        run_name=f"rag:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "rag",
            "request_id": request_id or "unknown",
        },
    )

    caller = _caller_for(provider)

    try:
        result = await caller(
            resolved_key,
            resolved_model,
            _SYSTEM_INSTRUCTION,
            user_prompt,
            config=trace_config,
        )
        if not result["answer"]:
            result["answer"] = "The model returned an empty response. Please try again."
            result["error"] = True
        return result
    except Exception as exc:
        logger.error("LLM call failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "answer": _failure_message(
                provider, resolved_model, exc,
                "I'm sorry, I encountered an error while formulating the answer.",
            ),
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }


async def generate_note_summary(
    title: str,
    category: str,
    content: str,
    contexts: list[str],
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
    mode: str = "brief",
) -> dict:
    """
    Summarize a single note. mode "brief": a compact summary. mode "actions":
    also returns `actions` (tasks, decisions, deadlines, people) extracted as
    structured data, with a one or two sentence summary.
    """
    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()

    if not has_credentials(resolved_key, resolved_model):
        return {
            "summary": "Add an active API key and model in profile settings to generate summaries.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    resolved_title = title.strip()
    resolved_category = category.strip()
    resolved_contexts = [context.strip() for context in contexts if context.strip()]

    sections: list[str] = []
    if resolved_title:
        sections.append(f"Title: {resolved_title}")
    if resolved_category:
        sections.append(f"Category: {resolved_category}")

    if resolved_contexts:
        sections.append("Indexed Note Context:\n\n" + "\n\n---\n\n".join(resolved_contexts))
    else:
        parsed = parse_note_html(content or "")
        note_text = parsed.text_content.strip()

        if not any([resolved_title, resolved_category, note_text, parsed.links]):
            return {
                "summary": "This note is empty, so there is nothing to summarize yet.",
                **({"actions": _normalize_actions({})} if mode == "actions" else {}),
                "tokens_used": 0,
                "run_id": None,
            }

        if note_text:
            sections.append(f"Note Content:\n{note_text}")
        if parsed.links:
            link_lines = [
                f"- {link.get('text') or link.get('href')}: {link.get('href')}"
                for link in parsed.links
                if link.get("href")
            ]
            if link_lines:
                sections.append("Links:\n" + "\n".join(link_lines))

    task = "Extract the action items from" if mode == "actions" else "Summarize"
    user_prompt = f"{task} this saved note.\n\n" + "\n\n".join(sections)

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return {
            "summary": "Unsupported model. Please check your AI settings.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    trace_config = build_langchain_config(
        run_name=f"summarize:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "summarize",
            "request_id": request_id or "unknown",
        },
    )

    caller = _caller_for(provider)

    try:
        result = await caller(
            resolved_key,
            resolved_model,
            _ACTIONS_SYSTEM_INSTRUCTION if mode == "actions" else _SUMMARY_SYSTEM_INSTRUCTION,
            user_prompt,
            config=trace_config,
        )
        if mode == "actions":
            parsed_actions = _parse_json_object(result.get("answer") or "")
            if not parsed_actions:
                return {
                    "summary": "The action items could not be extracted right now.",
                    "error": True,
                    "tokens_used": result["tokens_used"],
                    "run_id": result.get("run_id"),
                }
            summary = parsed_actions.get("summary")
            return {
                "summary": summary.strip() if isinstance(summary, str) else "",
                "actions": _normalize_actions(parsed_actions),
                "tokens_used": result["tokens_used"],
                "run_id": result.get("run_id"),
            }
        summary_text = (result.get("answer") or "").strip()
        if not summary_text:
            return {
                "summary": "The note could not be summarized right now.",
                "error": True,
                "tokens_used": result["tokens_used"],
                "run_id": result.get("run_id"),
            }
        return {
            "summary": summary_text,
            "tokens_used": result["tokens_used"],
            "run_id": result.get("run_id"),
        }
    except Exception as exc:
        logger.error("Note summary failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "summary": _failure_message(
                provider, resolved_model, exc,
                "I'm sorry, I encountered an error while generating the summary.",
            ),
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }


async def extract_image_content(
    image: bytes,
    mime_type: str,
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    """
    Read an image with the user's model: transcribe visible text (OCR) and
    describe the visual content. Returns {text, tokens_used}; raises on
    provider errors.
    """
    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()
    provider = detect_provider(resolved_model)

    trace_config = build_langchain_config(
        run_name=f"image_extract:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "image_extract",
            "request_id": request_id or "unknown",
        },
    )

    encoded = base64.b64encode(image).decode("ascii")
    user_content = [
        {"type": "text", "text": "Extract the searchable content of this image."},
        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}},
    ]

    caller = _caller_for(provider)

    result = await caller(
        resolved_key,
        resolved_model,
        _IMAGE_EXTRACTION_INSTRUCTION,
        user_content,
        config=trace_config,
    )
    return {"text": result["answer"], "tokens_used": result["tokens_used"]}


async def test_llm_connection(
    api_key: str, model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    """
    Verify that a given API key + model combination works.
    """
    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()

    if not has_credentials(resolved_key, resolved_model):
        return {"ok": False, "error": "api_key and model are required"}

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    trace_config = build_langchain_config(
        run_name=f"test_connection:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "test_connection",
            "request_id": request_id or "unknown",
        },
    )

    try:
        await _call(
            provider,
            resolved_key,
            resolved_model,
            "You are a test assistant.",
            "Say: OK",
            config=trace_config,
        )
        return {"ok": True, "error": None, "provider": provider}
    except Exception as exc:
        logger.info("Connection test for %s failed: %s", resolved_model, exc)
        if provider == "free":
            return {"ok": False, "error": _failure_message(provider, resolved_model, exc, "")}
        return {"ok": False, "error": provider_error_message(exc)}


async def generate_chat_rag_answer(
    query: str,
    chat_history: list[dict],
    current_chat_chunks: list[str],
    notes_chunks: list[str],
    similar_chat_chunks: list[str],
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()

    if not has_credentials(resolved_key, resolved_model):
        return {
            "answer": "Add an active API key and model in profile settings to enable AI search.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    formatted_current = "\n\n".join(current_chat_chunks) if current_chat_chunks else "None"
    formatted_notes = (
        "\n\n".join(f"[{i}] {chunk}" for i, chunk in enumerate(notes_chunks, start=1))
        if notes_chunks
        else "None"
    )
    formatted_similar = "\n\n".join(similar_chat_chunks) if similar_chat_chunks else "None"

    system_content = _CHAT_SYSTEM_INSTRUCTION.format(
        current_chat_chunks=formatted_current,
        notes_chunks=formatted_notes,
        similar_chat_chunks=formatted_similar
    )

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return {
            "answer": "Unsupported model. Please check your AI settings.",
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }

    trace_config = build_langchain_config(
        run_name=f"chat_rag:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "chat_rag",
            "request_id": request_id or "unknown",
        },
    )

    llm = _chat_model(provider, resolved_key, resolved_model, temperature=0.3)

    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    messages = [SystemMessage(content=system_content)]

    # The caller saves the new user message before loading history, so drop it
    # here to avoid sending the same question twice.
    history = list(chat_history)
    if history and history[-1].get("role") == "user" and history[-1].get("content") == query:
        history.pop()

    for msg in history:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))
            
    messages.append(HumanMessage(content=query))

    try:
        response = await llm.ainvoke(messages, config=trace_config or {})
        answer = _extract_message_text(response.content)
        return {
            "answer": answer or "The model returned an empty response. Please try again.",
            "error": not answer,
            "tokens_used": _extract_tokens_used(response),
            "run_id": _extract_run_id(trace_config)
        }
    except Exception as exc:
        logger.error("Chat RAG call failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "answer": _failure_message(
                provider, resolved_model, exc,
                "I'm sorry, I encountered an error while formulating the response.",
            ),
            "error": True,
            "tokens_used": 0,
            "run_id": None,
        }


async def rewrite_search_query(
    query: str,
    history: list[dict],
    api_key: str,
    model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    """
    Rewrite a vague or follow-up question into a standalone search query plus
    extra keywords. On any failure the original query comes back, flagged.
    """
    fallback = {"query": query, "keywords": [], "tokens_used": 0, "error": True}
    resolved_key = (api_key or "").strip()
    resolved_model = model.strip()
    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return fallback

    conversation = "\n".join(
        f"{'User' if msg.get('role') == 'user' else 'Assistant'}: {str(msg.get('content', ''))[:1000]}"
        for msg in history[-4:]
    )
    user_prompt = (f"Conversation:\n{conversation}\n\n" if conversation else "") + f"Question: {query}"

    trace_config = build_langchain_config(
        run_name=f"rewrite_query:{request_id or 'unknown'}",
        metadata={
            "provider": provider,
            "model_name": resolved_model,
            "user_id": user_id or "anonymous",
            "endpoint_name": "rewrite_query",
            "request_id": request_id or "unknown",
        },
    )
    caller = _caller_for(provider)
    try:
        result = await caller(resolved_key, resolved_model, _REWRITE_INSTRUCTION, user_prompt, config=trace_config)
    except Exception as exc:
        logger.error("Query rewrite failed [%s/%s]: %s", provider, resolved_model, exc)
        return fallback

    parsed = _parse_json_object(result["answer"])
    rewritten = parsed.get("query")
    if not isinstance(rewritten, str) or not rewritten.strip():
        return {**fallback, "tokens_used": result["tokens_used"]}
    keywords = parsed.get("keywords")
    return {
        "query": rewritten.strip()[:500],
        "keywords": [k.strip() for k in keywords if isinstance(k, str) and k.strip()][:8]
        if isinstance(keywords, list)
        else [],
        "tokens_used": result["tokens_used"],
        "error": False,
    }


def _normalize_actions(raw: dict) -> dict:
    """Keep only well-formed items of a model's action-item JSON (models vary in what they return)."""

    def text(value: Any) -> str | None:
        return value.strip() if isinstance(value, str) and value.strip() else None

    def items(key: str) -> list:
        value = raw.get(key)
        return value if isinstance(value, list) else []

    tasks = []
    for item in items("tasks"):
        item = {"task": item} if isinstance(item, str) else item
        if isinstance(item, dict) and text(item.get("task")):
            tasks.append(
                {
                    "task": text(item.get("task")),
                    "owner": text(item.get("owner")),
                    "due": text(item.get("due")),
                    "done": item.get("done") is True,
                }
            )
    deadlines = [
        {"what": text(item.get("what")), "when": text(item.get("when"))}
        for item in items("deadlines")
        if isinstance(item, dict) and text(item.get("what")) and text(item.get("when"))
    ]
    people = []
    for item in items("people"):
        item = {"name": item} if isinstance(item, str) else item
        if isinstance(item, dict) and text(item.get("name")):
            people.append({"name": text(item.get("name")), "role": text(item.get("role"))})
    return {
        "tasks": tasks[:50],
        "decisions": [d for d in (text(x) for x in items("decisions")) if d][:30],
        "deadlines": deadlines[:30],
        "people": people[:30],
    }


def _parse_json_object(text: str) -> dict:
    """The first JSON object in a model reply (models often wrap JSON in code fences)."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return {}
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _extract_run_id(config: dict[str, Any] | None) -> str | None:
    """Try to pull the run_id from the first LangChainTracer callback."""
    if not config:
        return None
    callbacks = config.get("callbacks", [])
    for cb in callbacks:
        run_id = getattr(cb, "run_id", None)
        if run_id:
            return str(run_id)
    return None


def _extract_message_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                if item.strip():
                    parts.append(item.strip())
                continue

            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    parts.append(text_value.strip())
                continue

            text_value = getattr(item, "text", None)
            if isinstance(text_value, str) and text_value.strip():
                parts.append(text_value.strip())
        return "\n".join(parts).strip()

    return str(content or "").strip()


def _extract_tokens_used(response: Any) -> int:
    usage_metadata = getattr(response, "usage_metadata", None)
    tokens = _extract_token_count_from_obj(usage_metadata)
    if tokens > 0:
        return tokens

    response_metadata = getattr(response, "response_metadata", None)
    tokens = _extract_token_count_from_obj(response_metadata)
    if tokens > 0:
        return tokens

    return 0


def _extract_token_count_from_obj(payload: Any) -> int:
    if isinstance(payload, dict):
        total_tokens = payload.get("total_tokens")
        if isinstance(total_tokens, int):
            return total_tokens

        total_token_count = payload.get("total_token_count")
        if isinstance(total_token_count, int):
            return total_token_count

        for key in ("token_usage", "usage", "usage_metadata"):
            nested = _extract_token_count_from_obj(payload.get(key))
            if nested > 0:
                return nested

        input_tokens = payload.get("input_tokens")
        output_tokens = payload.get("output_tokens")
        if isinstance(input_tokens, int) and isinstance(output_tokens, int):
            return input_tokens + output_tokens

        prompt_tokens = payload.get("prompt_token_count")
        candidate_tokens = payload.get("candidates_token_count")
        if isinstance(prompt_tokens, int) and isinstance(candidate_tokens, int):
            return prompt_tokens + candidate_tokens

        return 0

    return 0
