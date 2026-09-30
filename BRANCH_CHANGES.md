# Branch summary: `feature/indexing-and-retrieval`

Everything done on this branch, on top of `fix/search-chat-bugs` (which is contained in it). 7 commits, 104 files, about +9,000 / −2,100 lines. Nothing is pushed or merged yet.

| Commit | What |
|---|---|
| `69a3a15` | Bug fixes: chat retrieval, search filters, ingestion races |
| `471b495` | Background indexing queue, incremental re-indexing, hybrid search |
| `73aa4dd` | Query rewrite, optional Atlas `$vectorSearch` |
| `e52ee94` | Numbered citations and source jump |
| `58d0748` | Summary modes and action-item extraction |
| `4bd8ffc` | Save answer as note, similar notes, new chat |
| `aeb4f3e` | Fix: source highlight lost on re-render |

Architecture details live in [ai_search_architecture.md](ai_search_architecture.md); the roadmap is in [NEXT_PLANS.md](NEXT_PLANS.md).

---

## 1. Bug fixes (`69a3a15`)

**Chat**
- Chat now ranks note/file chunks by similarity and sends only the top 6 (plus the best chunks from conversations), instead of every chunk in the library on each message.
- Transcripts are re-chunked from the stored message count (the old parity check never fired).
- The answer is generated before anything is saved, so a failed answer no longer leaves an unanswered question or a saved apology in history.
- Works without embeddings (Claude, or a failed embedding call) by using the text index.

**AI search and summaries**
- Chat-transcript chunks are excluded from AI search sources.
- Per-provider similarity thresholds (OpenAI scores run lower than Gemini's); pinned notes skip the cutoff and get up to 12 chunks.
- Claude configs answer from keyword matches instead of refusing.
- Failed answers/summaries from apkh-search are flagged and no longer cached.

**Indexing**
- Ingestion is serialized per note and superseded runs are skipped, so rapid saves can't leave duplicate chunks; chunks of notes deleted mid-run are dropped.
- Removed the Gemini `text-embedding-004` fallback (768-d vectors never matched the index); the real embedding model name is stored.
- Re-index only when the embedding provider changes.
- `Note.userId` was untyped, so notes stored it as a string and the reindex query (ObjectId) found none. Queries matched both forms until the migration below.
- `contentPlain` keeps paragraphs on separate lines (fixes keyword search and generated titles).

**Setup and tests**
- `STORAGE_API_URL` sets where apkh-search downloads attachments from.
- Jest resolves `src/...` imports and has test secrets; added chat, users and html unit tests plus stdlib route tests for apkh-search.
- Profile no longer shows "Ready for grounded answers" for Claude keys.

## 2. Indexing and storage (`471b495`)

**Background queue (`index_jobs` collection)**
- One job per note or chat; it doubles as the index status (queued / processing / ready / failed).
- Atomic claims, at most one run per note, saves during a run re-queue it, retries with backoff (only for network errors, 429 and 5xx), stale-lock recovery after a crash, and fresh saves run ahead of bulk reindexes.
- Worker runs inside the API (concurrency 2). `INDEX_WORKER=off` disables it.
- Chat transcripts are indexed through the same queue.

**Incremental re-indexing**
- apkh-search's `/ingest` is split into `/ingest/extract`, `/ingest/chunk` and `/ingest/embed`, so the API only redoes what changed.
- `sourceHash` detects no-op saves; `textHash` lets unchanged passages keep their vectors; unchanged attachments are never re-downloaded or re-read.
- Per-attachment results (unreadable, unsupported, needs vision, failed) are recorded; failed attachments retry without redoing the rest.

What editing a note costs now:

| Change | Work done |
|---|---|
| Nothing searchable (e.g. category) | None |
| Title only | Chunks rewritten, no embedding |
| Text edit | Only changed passages embedded (in long notes, shifted chunk boundaries may re-embed a few later ones) |
| Attachment added | Only the new file is read |
| Attachment removed | Its chunks are dropped |
| Provider switch (Gemini ↔ OpenAI) | Stored text re-embedded, files not re-read |
| Switch to Claude | Nothing (keyword search only) |

**Storage layout**
- Real `ObjectId` schema types for ids (they were silently stored as strings).
- Chunks v2: `textHash`, embedding space label (`model@dimensions`, e.g. `gemini-embedding-001@1536`), `sessionId` for chat chunks, and a text index (`chunk_keyword_search`).
- Vectors stored as BSON binary float32: about 6 KB instead of about 21 KB per 1536-d vector.
- Gemini moves to 1536 dimensions; its old vectors are re-embedded from stored text, OpenAI's are converted in place.

**Startup migrations** (tracked in a `migrations` collection; idempotent; `RUN_MIGRATIONS=off` skips them)
- `2026-09-30-object-id-refs`
- `2026-09-30-chunks-v2`
- `2026-09-30-note-plain-text`
- `2026-09-30-summary-modes`

**Hybrid retrieval**
- Cosine similarity in the active embedding space plus MongoDB `$text`, merged by reciprocal rank fusion (k=60). Claude users get keyword search over notes and attachments.
- Gemini queries use the `RETRIEVAL_QUERY` task type.
- AI search reports how many notes are still indexing, and each reference says whether it matched by meaning, keywords or both.

**Web**
- Index status badges on note cards (with retry), and a Profile → Search index card with counts and a "Retry failed" button.

## 3. Query rewrite and Atlas vector search (`73aa4dd`)

- New `/ai-search/rewrite-query` in apkh-search: turns a question into a standalone query plus extra terms, using recent chat messages to resolve references. On any failure the original query is kept.
- AI search rewrites only when the first search is weak, searches again and merges both rankings; the answer shows what was also searched.
- Chat follow-ups that lean on the conversation ("and the budget for it?") are searched as a standalone question.
- Optional: with `ATLAS_VECTOR_INDEX` set, the semantic leg uses `$vectorSearch`. On error it falls back to the in-app scan and retries Atlas after 10 minutes. `npm run search:vector-index` creates the index (1536-d cosine).

## 4. Citations and source jump (`e52ee94`)

- RAG sources are numbered and cited inline (`[1]`, `[2][3]`). General knowledge is allowed only if labelled and uncited. This also replaces a system prompt with literal unfilled `{context}` placeholders.
- Chat replies cite note passages the same way; each assistant message stores its sources so citations survive reopening a conversation.
- `[n]` markers and source cards open a source viewer: note passages open the note scrolled to and highlighted (CSS Custom Highlight API, `<mark>` fallback); attachment passages open the file, PDFs at the cited page.

## 5. Summary modes and action items (`58d0748`)

- `/notes/:id/summary?mode=brief|actions`. The actions mode returns structured tasks (owner, due, done only when stated), decisions, deadlines and people, plus a short summary. Malformed items are dropped; a non-JSON reply is a failure and is not cached.
- Summaries are cached per note and mode (unique index moved to `noteId, userId, mode`).
- The note card summary panel has a Brief / Action items toggle and ignores answers about a version of the note that has since been edited.

## 6. Save as note, similar notes, new chat (`4bd8ffc`)

- **Save as note:** on AI answers and chat replies; creates a note in *AI Insights* with the answer and a numbered source list, then indexes it.
- **Similar notes:** `GET /notes/:id/similar` compares notes by the average of their passage vectors (per-provider floor, near-duplicates flagged at 0.95), or by shared words with a Claude key. Opened from note cards.
- **New chat:** `POST /chat/session` accepts an empty body; chats are named after the first question; the chat page has a New chat button.

## 7. Highlight fix (`aeb4f3e`)

React 19 re-applies `innerHTML` whenever the `dangerouslySetInnerHTML` object changes identity, which dropped the source highlight and text selection in previews. The `{ __html }` objects are now memoized in `sourceViewer.tsx` and `showNote.tsx`.

## Verification

- API: 43 unit tests, 26 integration tests (throwaway MongoDB). Python: 18 tests. Web: `tsc` and eslint clean.
- Browser run on isolated ports with a scratch MongoDB and a fake search service (no AI key): 11/11 steps passed, passage highlighted, no browser errors.
- **Not verified:** real AI output, Atlas `$vectorSearch` on a real Atlas index, and the similarity thresholds (heuristics that may need tuning).

## Things to know before merging

- Startup migrations rewrite data on first API start. Master's API can't read the converted records (its schema types ids as Mixed and it queries with strings), so don't run master against a migrated database without a down-migration.
- apkh-search must be restarted to serve the new `/ingest/*` and `/ai-search/rewrite-query` routes; until then indexing jobs fail (404 is not retried). Use Profile → Search index → "Retry failed" afterwards.

## Still on the roadmap

Auto tags, collections, explain-why-matched, daily digest, vision for charts/diagrams, backlinks, knowledge graph, saved searches, smart filters, export, share links, usage dashboard. Streaming answers and answer feedback are also not started.
