"""
Indexing endpoint tests. A local HTTP server stands in for apkh-storage; no
AI provider is called (the model used cannot read images).

Run from apkh-search/:  .venv/bin/python -B -m unittest discover -s tests
"""

import base64
import functools
import io
import os
import socketserver
import struct
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret")

import fitz  # noqa: E402
import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
import routes.ingest as ingest  # noqa: E402

TOKEN = jwt.encode({"_id": "user-1"}, os.environ["JWT_SECRET"], algorithm="HS256")
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NOTE_ID = "note-1"
TEXT_ONLY_MODEL = "gpt-3.5-turbo"


def _pdf(pages: list[str]) -> bytes:
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buffer, format="PNG")
    return buffer.getvalue()


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class _LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer.server_bind looks up the host's FQDN, which can stall for
        # ~30s on some networks; only the socket is needed here.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class ExtractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        note_dir = Path(cls.tmp.name) / "files" / NOTE_ID
        note_dir.mkdir(parents=True)
        long_text = "Quarterly planning notes covering hiring, budget and launch dates. " * 3
        (note_dir / "notes.txt").write_text("Plain text attachment about the Q3 launch.")
        (note_dir / "data.xyz").write_bytes(b"\x00\x01")
        (note_dir / "photo.png").write_bytes(_png())
        (note_dir / "report.pdf").write_bytes(_pdf([long_text, ""]))
        (note_dir / "scan.pdf").write_bytes(_pdf([""]))

        handler = functools.partial(_QuietHandler, directory=cls.tmp.name)
        cls.server = _LocalServer(("127.0.0.1", 0), handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.original_storage = ingest.STORAGE_BASE_URL
        ingest.STORAGE_BASE_URL = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        ingest.STORAGE_BASE_URL = cls.original_storage
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def extract(self, files: list[str]) -> dict:
        res = self.client.post(
            "/ingest/extract",
            json={"note_id": NOTE_ID, "files": files, "api_key": "k", "model": TEXT_ONLY_MODEL},
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 200, res.text)
        return {f["file_name"]: f for f in res.json()["files"]}

    def test_reports_a_status_for_every_file(self):
        files = self.extract(["notes.txt", "data.xyz", "photo.png", "gone.pdf", "report.pdf", "scan.pdf"])

        self.assertEqual(files["notes.txt"]["status"], "ok")
        self.assertIn("Q3 launch", files["notes.txt"]["text"])
        self.assertEqual(files["data.xyz"]["status"], "unsupported")
        self.assertEqual(files["photo.png"]["status"], "no_vision")
        self.assertEqual(files["gone.pdf"]["status"], "missing")
        # Text pages are read; the blank page is reported, not silently dropped.
        self.assertEqual(files["report.pdf"]["status"], "ok")
        self.assertIn("[Page 1]", files["report.pdf"]["text"])
        self.assertIn("1 scanned or blank page", files["report.pdf"]["warning"])
        # Only a scanned page and no model that can read it
        self.assertEqual(files["scan.pdf"]["status"], "no_vision")


class ChunkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def chunk(self, **body) -> list[dict]:
        res = self.client.post("/ingest/chunk", json=body, headers=AUTH)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["chunks"]

    def test_note_html_keeps_links_and_drops_file_tokens(self):
        chunks = self.chunk(
            content='<p>Plan <a href="https://x.dev">docs</a></p>'
            '<span class="file-token" data-id="f.pdf" data-name="f.pdf">f.pdf</span>',
        )
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["source_type"], "note")
        self.assertIn("docs (https://x.dev)", chunks[0]["text"])
        self.assertNotIn("f.pdf", chunks[0]["text"])

    def test_chat_transcripts_are_plain_text(self):
        chunks = self.chunk(content="User: is 3 < 5?\n\nAssistant: yes", content_format="text", source_type="chat")
        self.assertEqual(chunks[0]["source_type"], "chat")
        self.assertIn("3 < 5", chunks[0]["text"])

    def test_file_pages_keep_their_page_numbers(self):
        chunks = self.chunk(files=[{"file_name": "r.pdf", "text": "[Page 1]\nfirst\n\n[Page 2]\nsecond"}])
        self.assertEqual(
            [(c["source_name"], c["source_page"], c["text"]) for c in chunks],
            [("r.pdf", 1, "first"), ("r.pdf", 2, "second")],
        )


class EmbedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_claude_cannot_embed(self):
        res = self.client.post(
            "/ingest/embed",
            json={"texts": ["x"], "api_key": "k", "model": "claude-sonnet-4-5"},
            headers=AUTH,
        )
        self.assertEqual(res.status_code, 400)

    def test_vectors_round_trip_as_little_endian_float32(self):
        encoded = ingest.encode_vector([0.5, -1.25, 3.0])
        raw = base64.b64decode(encoded)
        self.assertEqual(struct.unpack("<3f", raw), (0.5, -1.25, 3.0))


if __name__ == "__main__":
    unittest.main()
