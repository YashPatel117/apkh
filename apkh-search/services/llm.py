"""
LLM service for answer generation using only per-request credentials.

Supported providers (detected by model name prefix):
  - Google Gemini  : model starts with "gemini-"
  - OpenAI         : model starts with "gpt-" or "o1" / "o3" / "o4"
  - Anthropic      : model starts with "claude-"
"""

import logging

logger = logging.getLogger(__name__)

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
            {"role": "user", "content": user_prompt},
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


async def generate_rag_answer(
    query: str,
    contexts: list[str],
    api_key: str,
    model: str,
) -> dict:
    """
    Generate an answer from the provided context chunks.
    """
    if not contexts:
        return {
            "answer": "I couldn't find any relevant information in your notes.",
            "tokens_used": 0,
        }

    resolved_key = api_key.strip()
    resolved_model = model.strip()

    if not resolved_key or not resolved_model:
        return {
            "answer": "Add an active API key and model in profile settings to enable AI search.",
            "tokens_used": 0,
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
        }

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
        }


async def test_llm_connection(api_key: str, model: str) -> dict:
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

    try:
        if provider == "gemini":
            await _call_gemini(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
            )
        elif provider == "openai":
            await _call_openai(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
            )
        else:
            await _call_anthropic(
                resolved_key,
                resolved_model,
                "You are a test assistant.",
                "Say: OK",
            )

        return {"ok": True, "error": None, "provider": provider}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
