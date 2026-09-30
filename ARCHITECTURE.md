# Architecture

How the four services work together: what is stored, how notes are indexed and re-indexed, how AI search, chat and summaries find their context, and what reaches the AI provider.

## 1. Services

```text
                 ┌──────────────┐
  Browser ──────►│  apkh-web    │  Next.js UI (3002)
                 └──────┬───────┘
          notes, chat,  │  file upload / download
          AI search     │  ─────────────────────────────┐
                 ┌──────▼───────┐                ┌──────▼───────┐
                 │  apkh-api    │───────────────►│ apkh-storage │  files on disk (3001)
                 │  NestJS 3000 │                └──────▲───────┘
                 └──┬───────┬───┘                       │ downloads attachments
          MongoDB ◄─┘       │ extract / chunk / embed / │
   (notes, chats, index)    ▼ generate                  │
                 ┌──────────────┐                       │
                 │ apkh-search  │───────────────────────┘
                 │ FastAPI 8000 │───► AI provider (the user's own key), or the free AI (Ollama)
                 └──────────────┘
```

**`apkh-api`** is the orchestration layer. It saves notes, chats and summaries in MongoDB; keeps the **search index** (chunks of note text, attachment text and chat transcripts, with their vectors); runs the **indexing queue and worker**; does **retrieval** (hybrid meaning + keyword search); reads the user's active AI config and tracks token usage; runs data migrations at startup.

**`apkh-search`** is the AI engine. It is stateless and only does what the API asks:

- **extract**: download attachments from `apkh-storage` and read their text (images and scanned PDF pages go to the user's model)
- **chunk**: split note / chat / attachment text into passages
- **embed**: turn passages and queries into vectors
- **generate**: RAG answers, chat replies, summaries and query rewrites
- **models / test**: list the models a key can use, and test a key + model

**`apkh-storage`** stores attachment files per note. **The AI provider** (OpenRouter, Gemini, OpenAI or Anthropic) only ever receives text, images and prompts for one request; it never sees the database. **The free AI** works the same way but runs on the host's own server (Ollama by default), so nothing leaves it.

**Auth between services.** Users log in to `apkh-api`, which issues a JWT. `apkh-storage` and `apkh-search` verify the same JWT with the shared `JWT_SECRET`. Background indexing jobs call the services with a short-lived token the API signs for the job's user, so no user token is stored with a job.

## 2. Repository layout

```text
apkh-api/src
  auth/  users/  notes/  chat/  file/     REST modules (controller + service + dto)
  indexing/        queue, worker, note & chat indexers, chunk store
  search/          AI search, retrieval (hybrid + vector search), query rewrite
  search-api/      HTTP client for apkh-search, embedding spaces
  database/        startup migrations
  common/          schemas, guards, decorators, utils
apkh-api/scripts   create-vector-index.mjs (Atlas index)

apkh-search
  main.py          app, CORS, JWT middleware
  routes/          ingest (extract/chunk/embed), ai_search, chat_rag, feedback
  services/        llm, embedder, free_ai, chunker, file_extractor, vision, html_parser, model_catalog

apkh-web/src
  app/             routes only: (home)/notes, chat, profile; login, register, reset-password
  components/      feature components;  components/ui: design-system primitives
  hooks/  context/  models/  lib/        shared logic, types and helpers
  services/        API clients (axios)
  store/           Redux slices

scripts/init-env.mjs   creates missing env files (used by setup-all.bat)
```

## 3. What is stored

| Collection | Holds |
|---|---|
| `users` | account, AI configs (key name, **encrypted** API key, model, active flag), token totals |
| `notes` | `userId`, `title`, `content` (Quill HTML), `contentPlain` (one line per paragraph), `category` |
| `notefiles` | attachment names per note (the bytes live in `apkh-storage`) |
| `knowledgechunks` | the search index, one document per passage |
| `index_jobs` | one job per note or chat: its indexing status, doubling as the queue |
| `summary` | cached note summaries, one per note and mode |
| `chatsessions`, `chatmessages` | conversations (assistant messages keep their cited sources) |
| `migrations` | which startup migrations have run |

**A chunk** has `userId` plus `noteId` (note and file passages) or `sessionId` (chat passages); `sourceType` (`note`, `file`, `chat`) with `sourceName` / `sourcePage` for attachments; `noteTitle`, `chunkIndex`, `text`; `textHash` (sha256 of the text, so an unchanged passage keeps its vector); `embeddingModel`, the **embedding space** of the vector (e.g. `gemini-embedding-001@1536`, unset for keyword-only chunks); and `vector`, stored as a BSON binary float32 vector (about 6 KB at 1536 dimensions instead of about 21 KB as an array). The text is kept on purpose: the index can be rebuilt for another provider without reading attachments again.

Indexes on the chunks: a MongoDB text index over `text`, `noteTitle` and `sourceName` (keyword search), and on Atlas the vector search index `chunk_vectors` (1536 dimensions, cosine, filterable by `userId`, `embeddingModel`, `sourceType`, `noteId`, `sessionId`).

**An index job** has `kind` (`note` / `chat`), `targetId`, `userId`; `status` (`queued` → `processing` → `ready`, or `failed` / `skipped` when there is no AI key); `files`, the result per attachment (`ok`, `empty`, `unsupported`, `no_vision`, `missing`, `failed`, with a reason); `sourceHash`, a hash of everything the last successful run indexed; and the queue fields `priority`, `runAt`, `attempts`, `lockedBy` / `lockedAt`, `requeue`.

## 4. AI keys, models and embeddings

A user saves one or more AI configs in Profile. When the API needs AI it reads the **active** config, decrypts the key and sends `api_key` + `model` with that single request; `apkh-search` never stores keys. A user with no active config uses the **free AI** (below), unless the host turned it off (`FREE_AI=off`).

**Providers.** OpenRouter (listed first), Gemini, OpenAI and Anthropic. The provider of a model is recognised from its id: OpenRouter ids are `author/model` (e.g. `qwen/qwen3.8-27b:free`) and no native id contains a `/`; the others are `gemini-*`, `gpt-*` / `chatgpt-*` / `o<N>` and `claude-*`. OpenRouter speaks the OpenAI API, so it is called with the OpenAI client pointed at `https://openrouter.ai/api/v1`.

**Free AI.** Open-source models the host runs for everyone: no key, no per-user quota, only the server's capacity as a limit. When no config is active the API sends the model id `free` with an empty key, and `apkh-search` (`free_ai.py`) calls the OpenAI-compatible server at `FREE_AI_BASE_URL`. That is Ollama on the same machine by default; llama.cpp, vLLM or a hosted endpoint work too.

- **Models:** Qwen3.5 4B for chat (about 3.4 GB of RAM, reads images, thinking turned off with `reasoning_effort: "none"`) and Qwen3-Embedding-0.6B for embeddings (about 2.9 GB loaded with the 8K context window; together about 6 GB).
- **Changing them:** the chat model can be swapped freely (`FREE_AI_CHAT_MODEL`, e.g. `qwen3.5:2b` for about twice the speed). The embedding model can't, because stored vectors are labelled with it.
- **Timeouts:** a CPU answers slowly and one request at a time, so the API gives free-AI calls four times its usual timeouts.
- **Switching:** users pick it in Profile (the **Free AI** row), or fall back to it by deleting their last key. The profile tells the web app whether it's on (`freeAi`).
- **Failures:** if the server is down or a model isn't pulled, users see a short "free AI isn't available right now" message, and the details go to the search-service log.

**Model list.** The picker is not hardcoded: `apkh-search` asks the provider which models the key can use (`model_catalog.py`), newest first. For OpenRouter these are its free models (`/api/v1/models?max_price=0`, a public list). For Gemini only models supporting `generateContent` are listed; for OpenAI dated snapshots that duplicate an alias are hidden. Non-chat models (image, speech…) are listed too and fail when used for chat. Whether a model can read images (for attachments) is known per model for OpenAI/Gemini/Claude, and looked up in OpenRouter's model list (input modalities, cached for an hour).

**Errors.** Provider errors are reduced to the provider's own one-line message (e.g. a quota message) before reaching the user; the full error goes to the search-service log.

**Embedding spaces.** Vectors are only comparable when the same model made them at the same size, so every vector is labelled with its space:

| Active provider | Embedding space | Search |
|---|---|---|
| Free AI | `qwen3-embedding-0.6b@1536` (1024 dimensions, zero-padded) | meaning + keyword |
| Gemini | `gemini-embedding-001@1536` | meaning + keyword |
| OpenAI | `text-embedding-3-small@1536` | meaning + keyword |
| OpenRouter | `text-embedding-3-small@1536` (OpenAI's model via OpenRouter, same space as OpenAI) | meaning + keyword; keyword only without credit |
| Anthropic (Claude) | none: Anthropic has no embedding model | keyword only |

**OpenRouter without credit.** The chat models offered are free, but the embedding model is paid (about $0.02 per million tokens). When OpenRouter answers 402 (no credit), `apkh-search` returns 402 and the API falls back: indexing stores the new passages without vectors (keyword-searchable; only chunks that have a vector carry the space label), AI search and chat answer from keyword matches, and similar notes compare words. After adding credit, editing a note or Profile > Rebuild index embeds what is missing.

Queries are embedded in the same space (for Gemini with the `RETRIEVAL_QUERY` task type, which pairs with `RETRIEVAL_DOCUMENT` for passages; for Qwen3-Embedding with its `Instruct: … Query:` prefix, which passages don't get). Vectors are L2-normalised. Qwen3-Embedding's 1024-dimension vectors are zero-padded to 1536 so one vector index serves every space; padding changes neither the norm nor any similarity.

## 5. Indexing

Indexing runs in the background: saving a note returns immediately, the card shows **Indexing**, and the note is searchable seconds later.

**Triggers:** a note is created or edited (job queued); a note is deleted (job and chunks deleted); the active provider changes (notes in another space are re-queued); "Retry" on a note, or "Retry failed" / "Rebuild index" in Profile; a chat gains 10 new messages since it was last indexed.

**The queue** is `index_jobs`. The worker inside `apkh-api` claims jobs with one atomic update, so:

- a note is never indexed twice at once; if it changes mid-run the job is flagged and runs again right after
- rapid saves collapse into one run of the latest version
- a note saved now jumps ahead of a bulk reindex (`priority`)
- failures retry with backoff (15 s, 30 s, 1 min, 2 min); the fifth failure marks the job `failed`. Errors that can't succeed on retry (an invalid key) fail at once
- a job left by a crashed API is picked up again (heartbeat + stale-lock recovery)

The worker runs two jobs at a time; `INDEX_WORKER=off` disables it on an instance.

**One run for a note:**

```text
index job for note N
  -> load the note and its attachment names
  -> nothing changed since the last run (sourceHash)?          -> done, no work
  -> attachments not read yet  -> apkh-search /ingest/extract  (download + read; images via the vision model)
  -> note text + new attachment text -> /ingest/chunk          (512 tokens, 64 overlap; per page for PDFs)
  -> passages whose text already has a vector in this space -> reuse it
     the rest -> /ingest/embed                                 (batches of 100)
  -> write the new chunks, then remove the old ones
  -> job ready (or queued for a retry if an attachment failed)
```

A note with no text still gets one chunk, its title, so it can be found. Chat transcripts only grow, so earlier passages keep their vectors and only the new tail is embedded.

**What an edit costs:**

| Change | Work done |
|---|---|
| Nothing indexable (e.g. only the category) | none: the run stops at the `sourceHash` check |
| Title only | chunks rewritten with the new title, no embedding calls |
| Text edit | only passages whose text changed are embedded |
| Attachment added / removed | only that file is read / its chunks are dropped |
| Provider switched | vectors rebuilt from stored text; no attachment is read again |
| Switched to Claude | nothing: stored chunks already serve keyword search |

Passages are split by size, so an edit near the start of a long note can shift later boundaries and re-embed those passages; attachments are never re-read for that. Attachments with nothing readable (`empty`, `unsupported`, `missing`) aren't downloaded again unless the index is rebuilt; failed ones retry automatically.

## 6. Retrieval

Every search (AI search, chat, similar notes) uses the same hybrid retrieval in `apkh-api` (`retrieval.service.ts`):

```text
query vector ──► meaning:  Atlas $vectorSearch (top 30 of 450 candidates, filtered by user, space and scope)
                           └─ in-API cosine similarity over the user's vectors if Atlas fails
query words  ──► keywords: MongoDB $text search (top 30)
                 └──────────► merged by reciprocal rank fusion (k = 60)
```

- **Keyword search** catches exact terms that embeddings blur (names, error codes) and is all Claude users get.
- **Atlas first, API as fallback.** Vector search runs on the Atlas index named by `ATLAS_VECTOR_INDEX` (default `chunk_vectors`; `off` disables it). If Atlas fails (index missing, not READY, not an Atlas cluster), the API computes cosine similarity itself and retries Atlas after 10 minutes. The API logs the mode at startup and, per search, where it ran and how long it took.
- Semantic matches below a per-provider similarity (free AI 0.45, Gemini 0.5, OpenAI 0.3) are ignored; confidence is "high" from free AI 0.6 / Gemini 0.7 / OpenAI 0.5, "medium" for keyword-only search.

## 7. AI search

```text
query -> embed (Gemini / OpenAI; skipped for Claude)
      -> hybrid retrieval over note + file chunks
      -> weak result? -> rewrite the query, search again, merge both rankings
      -> top 5 passages (up to 12 from pinned notes)
      -> apkh-search /ai-search/rag
      -> answer with [n] citations + references (each marked meaning, keyword or both)
```

- **Pinned notes** (`@mention`) restrict the search to those notes and skip the similarity cutoff, so broad questions still get the note's content.
- **Query rewrite** only happens when the first search is weak: the model turns the question into a standalone query with a few extra terms, and the answer shows what was also searched for.
- If the query can't be embedded (e.g. rate limit), the answer comes from keyword matches instead of failing.
- The response includes `pendingNotes`, the notes still being indexed. Chat transcripts are never AI-search sources.

**Citations and source jump.** Passages go to the model as numbered sources (`[1] Note "Plan" | File: q3.pdf | Page 2` + text) and it must cite them inline as `[1]`, `[2][3]`; general knowledge is only allowed labelled and uncited. Each reference is marked `cited` when its number appears. In the web app every `[n]` and source card opens the **source viewer**: a note passage opens the note scrolled to the highlighted passage (CSS Custom Highlight API, `<mark>` fallback); an attachment opens the file, PDFs at the cited page.

**Similar notes** (`GET /notes/:id/similar`). A note is represented by the average of its passage vectors. Atlas shortlists the 20 notes whose passages are nearest that average; those candidates are then ranked exactly by comparing averages (without Atlas, every note is a candidate). Notes below a per-provider floor (free AI 0.5, Gemini 0.6, OpenAI 0.35) aren't related; 0.95 and up are flagged as near-duplicates. With a Claude key, notes are compared by the words at their start.

**Save as note.** An AI answer or chat reply can be saved as a note in **AI Insights**: the answer plus a numbered source list so its citations still make sense. It's indexed like any note.

## 8. Chat

A chat starts from an AI answer ("Continue this conversation") or empty ("New chat", titled after its first question). For each message the API builds a small ranked context with the same retrieval, running three searches in parallel:

- up to **6** passages from notes and attachments
- up to **3** from this conversation's indexed transcript
- up to **3** from other conversations

plus the last 10 messages. A short follow-up that leans on the conversation ("and the budget for it?") is rewritten into a standalone question for the search; the model still answers the question as asked. The answer is generated before anything is saved, so a failure leaves no unanswered question in the history. Chat answers cite note passages like AI search, and the sources are saved with the message so citations work when the chat is reopened.

## 9. Summaries

`POST /notes/:id/summary?mode=brief|actions`:

- `brief` (default): a compact summary under 120 words.
- `actions`: action items first, as structured data: `tasks` (`owner`, `due`, `done` only when the note says so), `decisions`, `deadlines`, `people`, plus a one or two sentence summary. Malformed items are dropped; a reply that isn't JSON is a failure.

Each mode is cached separately. A cached summary costs no tokens; otherwise the note's chunks (text + attachments, in order) are sent to `/ai-search/summarize`. While the note is being re-indexed its current text is used and the result isn't cached. Failures are never cached, and editing or deleting the note clears its summaries.

## 10. Token usage

`apkh-search` reports tokens for answers, summaries, image reads and embeddings (embedding tokens are counted locally, as the SDKs don't return them); the API adds them to the active config's and the user's totals.

## 11. Startup migrations

Before serving requests the API runs any migration not yet recorded in `migrations` (each is idempotent; `RUN_MIGRATIONS=off` skips them):

1. **object-id-refs**: id fields stored as strings become real ObjectIds.
2. **chunks-v2**: hashes chunk text; converts OpenAI vectors to binary; drops old 3072-dimension Gemini vectors so those notes are re-embedded from stored text; removes old chat chunks, which are rebuilt.
3. **note-plain-text**: recomputes `contentPlain` with one line per paragraph.
4. **summary-modes**: existing summaries become `brief`; the unique index moves to (note, user, mode).

Notes indexed before the queue existed get their jobs the first time the user opens the app (a background "reconcile" also queues anything missing or in the wrong space).

## 12. Short version

```text
Indexing:   note save -> index_jobs -> worker -> extract (new files only) -> chunk -> embed (new text only) -> knowledgechunks
AI search:  query -> [embed] -> hybrid retrieval (Atlas vectors + keywords) -> [rewrite if weak] -> RAG answer + citations
Chat:       message -> [embed] -> notes + this chat + other chats (ranked, capped) -> answer -> saved with sources
Summary:    cached? -> else note chunks -> summarize -> cache
```
