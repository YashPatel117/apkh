"""
LLM Service for Answer Generation — supports multiple providers.

Supported providers (detected by model name prefix):
  - Google Gemini  : model starts with "gemini-"   → uses google-genai SDK
  - OpenAI         : model starts with "gpt-" or "o1" / "o3" / "o4"  → uses openai SDK
  - Anthropic      : model starts with "claude-"   → uses anthropic SDK

Per-request api_key and model are passed in. Falls back to env vars if not provided.
"""

import os
import logging
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
load_dotenv()

# ── Fallback env vars (used when user hasn't configured their own key) ──────
_DEFAULT_GEMINI_KEY  = os.getenv("GEMINI_KEY", "")
_DEFAULT_OPENAI_KEY  = os.getenv("OPENAI_KEY", "")
_DEFAULT_CLAUDE_KEY  = os.getenv("ANTHROPIC_KEY", "")
_DEFAULT_MODEL       = os.getenv("DEFAULT_LLM_MODEL", "gemini-2.5-flash")

# ── Shared system prompt ─────────────────────────────────────────────────────
_SYSTEM_INSTRUCTION = (
    "You are a personal knowledge assistant. Your job is to answer the user's question "
    "using ONLY the information in the provided context sections.\n\n"
    "Rules:\n"
    "- If the answer is clearly present in the context, answer it directly.\n"
    "- If the answer is partially present, answer what you can and note what is missing.\n"
    "- If the answer is not in the context at all, say: "
    "'I couldn't find information about this in your notes.'\n"
    "- Do not make up or infer information not explicitly stated in the context.\n"
    "- Be concise. Prefer bullet points for multi-part answers."
)


def _detect_provider(model: str) -> str:
    """Detect provider from model name."""
    m = model.lower()
    if m.startswith("gemini"):
        return "gemini"
    if m.startswith("gpt") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return "openai"
    if m.startswith("claude"):
        return "anthropic"
    raise ValueError(f"Cannot detect provider for model '{model}'. "
                     "Model name must start with 'gemini-', 'gpt-', 'o1'/'o3'/'o4', or 'claude-'.")


# ── Provider implementations ─────────────────────────────────────────────────

async def _call_gemini(api_key: str, model: str, system: str, user_prompt: str) -> dict:
    from google import genai
    from google.genai import types as gtypes

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=user_prompt,
        config=gtypes.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
        ),
    )
    tokens_used = 0
    if response.usage_metadata:
        tokens_used = response.usage_metadata.total_token_count or 0
    return {"answer": response.text, "tokens_used": tokens_used}


async def _call_openai(api_key: str, model: str, system: str, user_prompt: str) -> dict:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user_prompt},
        ],
    )
    tokens_used = response.usage.total_tokens if response.usage else 0
    answer = response.choices[0].message.content or ""
    return {"answer": answer, "tokens_used": tokens_used}


async def _call_anthropic(api_key: str, model: str, system: str, user_prompt: str) -> dict:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_prompt}],
    )
    tokens_used = (
        (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)
        if response.usage else 0
    )
    answer = response.content[0].text if response.content else ""
    return {"answer": answer, "tokens_used": tokens_used}


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_rag_answer(
    query: str,
    contexts: list[str],
    api_key: str | None = None,
    model: str | None = None,
) -> dict:
    """
    Generate an answer from the provided context chunks.

    Args:
        query:    The user's question.
        contexts: List of retrieved context strings.
        api_key:  User's API key for their chosen provider. Falls back to env var.
        model:    Model identifier (e.g. 'gpt-4o', 'claude-3-5-sonnet-20241022').
                  Falls back to DEFAULT_LLM_MODEL env var.

    Returns:
        { "answer": str, "tokens_used": int }
    """
    if not contexts:
        return {
            "answer": "I couldn't find any relevant information in your notes.",
            "tokens_used": 0,
        }

    resolved_model = (model or _DEFAULT_MODEL).strip()
    context_text   = "\n\n---\n\n".join(contexts)
    user_prompt    = f"Context:\n\n{context_text}\n\n---\n\nUser Question: {query}"

    try:
        provider = _detect_provider(resolved_model)
    except ValueError as e:
        logger.error(str(e))
        return {"answer": "Unsupported model. Please check your AI settings.", "tokens_used": 0}

    # Resolve API key (user-supplied takes priority over env fallback)
    if provider == "gemini":
        resolved_key = api_key or _DEFAULT_GEMINI_KEY
        caller = _call_gemini
    elif provider == "openai":
        resolved_key = api_key or _DEFAULT_OPENAI_KEY
        caller = _call_openai
    else:  # anthropic
        resolved_key = api_key or _DEFAULT_CLAUDE_KEY
        caller = _call_anthropic

    if not resolved_key:
        return {
            "answer": "No API key configured. Please add your API key in profile settings.",
            "tokens_used": 0,
        }

    try:
        result = await caller(resolved_key, resolved_model, _SYSTEM_INSTRUCTION, user_prompt)
        logger.info(f"RAG answer generated via {provider}/{resolved_model} — {result['tokens_used']} tokens")
        return result
    except Exception as e:
        logger.error(f"LLM call failed [{provider}/{resolved_model}]: {e}")
        return {
            "answer": "I'm sorry, I encountered an error while formulating the answer.",
            "tokens_used": 0,
        }


async def test_llm_connection(api_key: str, model: str) -> dict:
    """
    Verify that a given API key + model combination works.
    Sends a minimal single-token prompt and returns success/error.

    Returns:
        { "ok": bool, "error": str | None }
    """
    try:
        provider = _detect_provider(model)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    try:
        if provider == "gemini":
            result = await _call_gemini(api_key, model, "You are a test assistant.", "Say: OK")
        elif provider == "openai":
            result = await _call_openai(api_key, model, "You are a test assistant.", "Say: OK")
        else:
            result = await _call_anthropic(api_key, model, "You are a test assistant.", "Say: OK")

        return {"ok": True, "error": None, "provider": provider}
    except Exception as e:
        return {"ok": False, "error": str(e)}

