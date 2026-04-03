"""
LLM service for answer generation using only per-request credentials.

Supported providers (detected by model name prefix):
  - Google Gemini  : model starts with "gemini-"
  - OpenAI         : model starts with "gpt-" or "o1" / "o3" / "o4"
  - Anthropic      : model starts with "claude-"
"""

import logging

from services.html_parser import parse_note_html

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


async def generate_note_summary(
    title: str,
    category: str,
    content: str,
    contexts: list[str],
    api_key: str,
    model: str,
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
            _SUMMARY_SYSTEM_INSTRUCTION,
            user_prompt,
        )
        summary_text = (result.get("answer") or "").strip()
        if not summary_text:
            return {
                "summary": "The note could not be summarized right now.",
                "tokens_used": result["tokens_used"],
            }
        logger.info(
            "Note summary generated via %s/%s - %s tokens",
            provider,
            resolved_model,
            result["tokens_used"],
        )
        return {"summary": summary_text, "tokens_used": result["tokens_used"]}
    except Exception as exc:
        logger.error("Note summary failed [%s/%s]: %s", provider, resolved_model, exc)
        return {
            "summary": "I'm sorry, I encountered an error while generating the summary.",
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
