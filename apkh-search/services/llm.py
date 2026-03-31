"""
LLM Service for Answer Generation using Google Gemini.
Uses gemini-1.5-flash model for fast and context-heavy RAG responses.
"""

import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Ensure .env is loaded independently in case of import ordering issues
load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_KEY", "GEMINI_KEY")
QA_MODEL = "gemini-2.5-flash"


def get_client():
    return genai.Client(api_key=GEMINI_KEY)


async def generate_rag_answer(query: str, contexts: list[str]) -> str:
    """
    Generate an answer based purely on the provided context strings.
    """
    if not contexts:
        return "I couldn't find any relevant information in your notes."

    client = get_client()

    # Build the RAG Prompt
    system_instruction = (
        "You are a personal knowledge assistant. Your job is to answer the user's question "
        "using ONLY the information in the provided context sections.\n\n"
        "Rules:\n"
        "- If the answer is clearly present in the context, answer it directly.\n"
        "- If the answer is partially present, answer what you can and note what is missing.\n"
        "- If the answer is not in the context at all, say: 'I couldn't find information about this in your notes.'\n"
        "- Do not make up or infer information not explicitly stated in the context.\n"
        "- Be concise. Prefer bullet points for multi-part answers."
    )

    context_text = "\n\n---\n\n".join(contexts)

    user_prompt = f"Context:\n\n{context_text}\n\n---\n\nUser Question: {query}"

    try:
        response = client.models.generate_content(
            model=QA_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.2, # Low temperature for accurate, factual responses
            )
        )
        return response.text
    except Exception as e:
        logger.error(f"Failed to generate RAG answer: {e}")
        return "I'm sorry, I encountered an error while formulating the answer."
