"""
LLM service for answer generation using only per-request credentials.

Supported providers (detected by model name prefix):
  - Google Gemini  : model starts with "gemini-"
  - OpenAI         : model starts with "gpt-" or "o1" / "o3" / "o4"
  - Anthropic      : model starts with "claude-"
"""

import logging
import traceback
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from services.html_parser import parse_note_html
from services.langsmith_config import build_langchain_config

logger = logging.getLogger(__name__)

_SYSTEM_INSTRUCTION = (
    "You are an intelligent Knowledge Base Assistant. Your objective is to answer the user's query by analyzing their provided notes/documents ({context}) and deciding when it is appropriate to use external knowledge.. \n\n"
    "### 🧠 DECISION LOGIC. \n"
    "Before generating an answer, silently evaluate the user's query and choose one of the following strategies:. \n\n"
    "1. STRICTLY CONTEXT (Document-Specific Queries):. \n"
    "   - Trigger: The user asks about specific details within their uploaded files, personal data, or summarizes a note.. \n"
    "   - Action: Answer ONLY using the {context}. Do not use outside knowledge. If the answer is completely missing, state: I couldn't find information about this in your current notes.. \n\n"
    "2. HYBRID (Context + External Enrichment):. \n"
    "   - Trigger: The query references a concept in the notes but requires broader explanation, or asks to compare note content with general facts.. \n"
    "   - Action: Synthesize both. Clearly distinguish between what is in the user's notes and what comes from external knowledge (e.g., According to your notes... Additionally, general knowledge indicates...). \n\n"
    "3. EXTERNAL ONLY (General Queries):. \n"
    "   - Trigger: The query is entirely unrelated to the provided {context}.. \n"
    "   - Action: Ignore the empty/irrelevant context. Answer using your general knowledge or search capabilities, but keep it concise.. \n\n"
    "### 🛑 STRICT RULES. \n"
    "- ZERO HALLUCINATION: Never invent, assume, or infer personal information or document contents that are not explicitly provided in the {context}.. \n"
    "- PARTIAL MATCHES: If a question is only partially answered by the notes, provide the available information and explicitly state what details are missing from the context.. \n"
    "- FORMATTING: Be concise and highly readable. Prioritize bullet points for multi-part answers, lists, or comparisons. Drop unnecessary conversational filler.. \n"
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


def detect_provider(model: str) -> str:
    """Detect provider from model name."""
    normalized = model.lower()
    if normalized.startswith("gemini"):
        return "gemini"
    if normalized.startswith(("gpt", "o1", "o3", "o4")):
        return "openai"
    if normalized.startswith("claude"):
        return "anthropic"
    raise ValueError(
        f"Cannot detect provider for model '{model}'. "
        "Model name must start with 'gemini-', 'gpt-', 'o1'/'o3'/'o4', or 'claude-'."
    )


async def _call_gemini(
    api_key: str, model: str, system: str, user_prompt: str,
    config: dict[str, Any] | None = None,
) -> dict:
    chat = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.2,
    )
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


async def _call_openai(
    api_key: str, model: str, system: str, user_prompt: str,
    config: dict[str, Any] | None = None,
) -> dict:
    chat = ChatOpenAI(
        model=model,
        api_key=api_key,
        temperature=0.2,
    )
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


async def _call_anthropic(
    api_key: str, model: str, system: str, user_prompt: str,
    config: dict[str, Any] | None = None,
) -> dict:
    chat = ChatAnthropic(
        model=model,
        api_key=api_key,
        max_tokens=2048,
        temperature=0.2,
    )
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

    resolved_key = api_key.strip()
    resolved_model = model.strip()

    if not resolved_key or not resolved_model:
        return {
            "answer": "Add an active API key and model in profile settings to enable AI search.",
            "tokens_used": 0,
            "run_id": None,
        }

    context_text = "\n\n---\n\n".join(contexts)
    user_prompt = f"Context:\n\n{context_text}\n\n---\n\nUser Question: {query}"

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return {
            "answer": "Unsupported model. Please check your AI settings.",
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

    if provider == "gemini":
        caller = _call_gemini
    elif provider == "openai":
        caller = _call_openai
    else:
        caller = _call_anthropic

    try:
        result = await caller(
            resolved_key,
            resolved_model,
            _SYSTEM_INSTRUCTION,
            user_prompt,
            config=trace_config,
        )
        logger.info(
            "RAG answer generated via %s/%s - %s tokens",
            provider,
            resolved_model,
            result["tokens_used"],
        )
        return result
    except Exception as exc:
        logger.error("LLM call failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "answer": "I'm sorry, I encountered an error while formulating the answer.",
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
) -> dict:
    """
    Generate a concise summary for a single note.
    """
    resolved_key = api_key.strip()
    resolved_model = model.strip()

    if not resolved_key or not resolved_model:
        return {
            "summary": "Add an active API key and model in profile settings to generate summaries.",
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

    user_prompt = "Summarize this saved note.\n\n" + "\n\n".join(sections)

    try:
        provider = detect_provider(resolved_model)
    except ValueError as exc:
        logger.error(str(exc))
        return {
            "summary": "Unsupported model. Please check your AI settings.",
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

    if provider == "gemini":
        caller = _call_gemini
    elif provider == "openai":
        caller = _call_openai
    else:
        caller = _call_anthropic

    try:
        result = await caller(
            resolved_key,
            resolved_model,
            _SUMMARY_SYSTEM_INSTRUCTION,
            user_prompt,
            config=trace_config,
        )
        summary_text = (result.get("answer") or "").strip()
        if not summary_text:
            return {
                "summary": "The note could not be summarized right now.",
                "tokens_used": result["tokens_used"],
                "run_id": result.get("run_id"),
            }
        logger.info(
            "Note summary generated via %s/%s - %s tokens",
            provider,
            resolved_model,
            result["tokens_used"],
        )
        return {
            "summary": summary_text,
            "tokens_used": result["tokens_used"],
            "run_id": result.get("run_id"),
        }
    except Exception as exc:
        logger.error("Note summary failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "summary": "I'm sorry, I encountered an error while generating the summary.",
            "tokens_used": 0,
            "run_id": None,
        }


async def test_llm_connection(
    api_key: str, model: str,
    user_id: str | None = None,
    request_id: str | None = None,
) -> dict:
    """
    Verify that a given API key + model combination works.
    """
    resolved_key = api_key.strip()
    resolved_model = model.strip()

    if not resolved_key or not resolved_model:
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
        if provider == "gemini":
            await _call_gemini(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
                config=trace_config,
            )
        elif provider == "openai":
            await _call_openai(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
                config=trace_config,
            )
        else:
            await _call_anthropic(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
                config=trace_config,
            )

        return {"ok": True, "error": None, "provider": provider}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


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
