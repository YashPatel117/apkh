"""
Route tests that never reach an AI provider.

Run from apkh-search/:  .venv/bin/python -B -m unittest discover -s tests
"""

import os
import unittest

os.environ.setdefault("JWT_SECRET", "test-secret")

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import services.llm as llm  # noqa: E402
from services.embedder import EmbeddingError, resolve_space  # noqa: E402

TOKEN = jwt.encode({"_id": "user-1"}, os.environ["JWT_SECRET"], algorithm="HS256")
AUTH = {"Authorization": f"Bearer {TOKEN}"}
UNSUPPORTED_MODEL = "mystery-model"


class ErrorFlagTests(unittest.TestCase):
    """Failures must be flagged so the API never caches or saves them as real answers."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_rag_failure_is_flagged(self):
        res = self.client.post(
            "/ai-search/rag",
            json={"query": "q", "contexts": ["[SOURCE: Note]\ntext"], "api_key": "k", "model": UNSUPPORTED_MODEL},
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["error"])

    def test_summary_failure_is_flagged(self):
        res = self.client.post(
            "/ai-search/summarize",
            json={"title": "t", "content": "<p>body</p>", "api_key": "k", "model": UNSUPPORTED_MODEL},
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["error"])

    def test_chat_failure_is_flagged(self):
        res = self.client.post(
            "/ai-search/chat-rag",
            json={
                "query": "q",
                "chat_history": [],
                "current_chat_chunks": [],
                "notes_chunks": [],
                "similar_chat_chunks": [],
                "api_key": "k",
                "model": UNSUPPORTED_MODEL,
            },
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["error"])

    def test_requests_without_a_token_are_rejected(self):
        res = self.client.post("/ai-search/rag", json={})
        self.assertEqual(res.status_code, 401)


class RewriteQueryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def rewrite(self, **body):
        res = self.client.post(
            "/ai-search/rewrite-query",
            json={"api_key": "k", "model": "gpt-4o-mini", **body},
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_falls_back_to_the_original_query(self):
        result = self.rewrite(query="the second one?", model=UNSUPPORTED_MODEL)
        self.assertEqual(result, {"query": "the second one?", "keywords": [], "tokens_used": 0, "error": True})

    def test_uses_the_conversation_and_parses_fenced_json(self):
        prompts = []

        async def fake_call(api_key, model, system, user_prompt, config=None):
            prompts.append(user_prompt)
            return {
                "answer": '```json\n{"query": "Q3 launch budget", "keywords": ["budget", "launch", 7]}\n```',
                "tokens_used": 12,
                "run_id": None,
            }

        original = llm._call_openai
        llm._call_openai = fake_call
        try:
            result = self.rewrite(
                query="and the budget for it?",
                history=[
                    {"role": "user", "content": "When is the Q3 launch?"},
                    {"role": "assistant", "content": "September 30."},
                ],
            )
        finally:
            llm._call_openai = original

        self.assertEqual(result, {"query": "Q3 launch budget", "keywords": ["budget", "launch"], "tokens_used": 12, "error": False})
        self.assertIn("User: When is the Q3 launch?", prompts[0])
        self.assertTrue(prompts[0].endswith("Question: and the budget for it?"))


class EmbeddingSpaceTests(unittest.TestCase):
    def test_each_provider_has_one_embedding_space(self):
        gemini = resolve_space("gemini-2.5-flash")
        self.assertEqual((gemini.model, gemini.dimensions), ("gemini-embedding-001", 1536))
        openai = resolve_space("gpt-4o-mini")
        self.assertEqual((openai.model, openai.dimensions), ("text-embedding-3-small", 1536))

    def test_claude_has_no_embedding_space(self):
        with self.assertRaises(EmbeddingError) as ctx:
            resolve_space("claude-sonnet-4-5")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_unknown_spaces_are_rejected(self):
        with self.assertRaises(EmbeddingError):
            resolve_space("gpt-4o-mini", "text-embedding-3-large")
        with self.assertRaises(EmbeddingError):
            resolve_space("gemini-2.5-flash", dimensions=999)


if __name__ == "__main__":
    unittest.main()
