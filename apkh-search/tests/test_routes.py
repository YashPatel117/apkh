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
from services.embedder import embedding_model_for  # noqa: E402

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


class EmbeddingModelTests(unittest.TestCase):
    def test_each_provider_has_one_fixed_embedding_model(self):
        self.assertEqual(embedding_model_for("gemini-2.5-flash"), "gemini-embedding-001")
        self.assertEqual(embedding_model_for("gpt-4o-mini"), "text-embedding-3-small")
        self.assertIsNone(embedding_model_for("claude-sonnet-4-5"))


if __name__ == "__main__":
    unittest.main()
