# AI-Powered Personal Knowledge Hub

## API <-> Search <-> AI Model Flow

This document explains how `apkh-api` and `apkh-search` work together: what is stored, how notes are indexed (and re-indexed when they change), how AI search, chat and summaries find their context, and what reaches the AI provider.

## 1. Main Responsibilities

### `apkh-api`

The orchestration layer. It:

- saves notes, chats and summaries in MongoDB
- keeps the **search index**: chunks of note text, attachment text and chat transcripts, with their vectors
- runs the **indexing queue and worker** that keep that index up to date in the background
- does **retrieval**: hybrid (meaning + keyword) search over the chunks
- reads the user's active AI config and tracks token usage
- runs data migrations at startup

### `apkh-search`

The AI processing engine. It is stateless: it stores nothing and does only what the API asks.

- **extract**: download attachments from `apkh-storage` and read their text (images and scanned PDF pages go to the user's vision model)
- **chunk**: split note / chat / attachment text into passages
- **embed**: turn passages and search queries into vectors
- **generate**: RAG answers, chat replies and summaries with the user's model

### AI provider

OpenAI, Gemini or Anthropic, depending on the active config. It is only called to read images, embed text, and generate answers and summaries. It never sees the database.

## 2. What Is Stored

| Collection | What it holds |
|---|---|
| `notes` | `userId`, `title`, `content` (Quill HTML), `contentPlain` (one line per paragraph), `category` |
| `notefiles` | the attachment file names of each note (the bytes live in `apkh-storage`) |
| `knowledgechunks` | the search index: one document per passage (see below) |
| `index_jobs` | one job per note or chat: its indexing status, doubling as the queue |
| `summary` | cached note summaries |
| `chatsessions`, `chatmessages` | conversations |
| `migrations` | which startup data migrations have run |

### A chunk (`knowledgechunks`)

- `userId`, and `noteId` (note and file passages) or `sessionId` (chat passages)
- `sourceType`: `note`, `file` or `chat`; `sourceName` / `sourcePage` for attachments
- `noteTitle`, `chunkIndex`, `text`
- `textHash`: sha256 of `text`. An unchanged passage keeps its vector (see section 6)
- `embeddingModel`: the **embedding space** of the vector, e.g. `gemini-embedding-001@1536`; unset for keyword-only chunks
- `vector`: the embedding as a BSON binary float32 vector (about 6 KB at 1536 dimensions, versus ~21 KB as an array of numbers)

The chunk text is kept on purpose: the index can be rebuilt for another provider from stored text alone, without downloading or reading attachments again.

A MongoDB text index over `text`, `noteTitle` and `sourceName` powers keyword search.

### An index job (`index_jobs`)

- `kind` (`note` / `chat`), `targetId`, `userId`
- `status`: `queued` → `processing` → `ready`, or `failed` / `skipped` (no AI key)
- `files`: what happened to each attachment (`ok`, `empty`, `unsupported`, `no_vision`, `missing`, `failed`, with a reason)
- `sourceHash`: a hash of everything the last successful run indexed
- queue fields: `priority`, `runAt` (retry backoff), `attempts`, `lockedBy` / `lockedAt` (heartbeat), `requeue`

## 3. Where the API Key and Model Come From

The user saves one or more AI configs in Profile (key name, encrypted API key, model, active flag). When the API needs AI it reads the **active** config, decrypts the key, and sends `api_key` + `model` with that one request to `apkh-search`. The search service never stores keys.

## 4. Embedding Spaces

Vectors are only comparable when the same model made them at the same size, so every stored vector is labelled with its space:

| Active provider | Embedding space | Search |
|---|---|---|
| Gemini | `gemini-embedding-001@1536` | meaning + keyword |
| OpenAI | `text-embedding-3-small@1536` | meaning + keyword |
| Anthropic (Claude) | none — Anthropic has no embedding model | keyword only |

Queries are embedded in the same space (for Gemini with the query task type, which pairs with the document task type used for passages). Vectors are L2-normalised.

## 5. Indexing

Indexing runs in the background. Saving a note returns immediately; the note becomes searchable a few seconds later, and its card shows **Indexing** meanwhile.

### When a note is indexed

- the note is created or edited → its job is (re)queued
- the note is deleted → its job and chunks are deleted
- the active provider changes → notes whose vectors are in another space are re-queued
- "Retry" on a note, "Retry failed" / "Rebuild index" in Profile

### The queue

`index_jobs` is the queue. The worker in `apkh-api` claims jobs with a single atomic update, so:

- a note is never indexed twice at the same time; if it changes while being indexed, the job is flagged and runs again right after
- rapid saves collapse into one run of the latest version
- a note saved now jumps ahead of a bulk reindex (`priority`)
- failures retry with backoff (after 15 s, 30 s, 1 min, 2 min); a fifth failed attempt marks the job `failed`. Errors that can't succeed on retry (such as an invalid API key) fail at once
- a job left behind by a crashed or restarted API is picked up again (heartbeat + stale lock recovery)

The worker runs two jobs at a time. `INDEX_WORKER=off` disables it on an instance.

### One indexing run (a note)

```text
index job for note N
  -> load the note and its attachment names
  -> nothing changed since the last run (sourceHash)?  -> done, no work
  -> attachments not indexed yet -> apkh-search /ingest/extract  (download + read)
  -> note text + newly read attachments -> apkh-search /ingest/chunk
  -> passages whose text already has a vector in this space -> reuse it
     the rest -> apkh-search /ingest/embed
  -> write the new chunks, then remove the old ones
  -> job ready (or queued for a retry if an attachment failed)
```

A note with no text still gets one chunk, its title, so it can be found.

Service calls from the worker carry a short-lived token the API signs for the user, so no user token is stored with jobs.

### Chats

A conversation is indexed once it has 10 new messages since its last indexing, so later chats can draw on it ("related past chats"). Transcripts only grow, so earlier passages keep their vectors and only the new tail is embedded.

## 6. What Editing a Note Costs

Earlier versions re-downloaded and re-read every attachment and re-embedded every passage on every save, even for a category change. Now:

| Change | What happens |
|---|---|
| Nothing indexable (e.g. only the category) | nothing: the run stops at the `sourceHash` check |
| Title only | chunks are rewritten with the new title; no embedding calls |
| Edit to the text | only passages whose text changed are embedded; attachments are untouched |
| Attachment added | only that file is downloaded, read and embedded |
| Attachment removed | its chunks are dropped |
| Provider switched | vectors rebuilt from the stored text; no attachment is read again |
| Switched to Claude | nothing: stored chunks already serve keyword search |

One nuance: passages are split by size, so an edit near the start of a long note can shift the passage boundaries after it, and those passages are embedded again. The expensive part (downloading and reading attachments, and image/scanned-page reads by the vision model) is never repeated for unchanged files.

Attachments that had nothing readable (`empty`, `unsupported`, `missing`) are not downloaded again unless you rebuild the index; ones that failed are retried automatically.

## 7. AI Search

```text
query
  -> embed the query (Gemini / OpenAI)            [skipped for Claude]
  -> hybrid retrieval over note + file chunks:
       meaning: cosine similarity within the active space
       keywords: MongoDB text search
       merged by reciprocal rank fusion
  -> top 5 passages (up to 12 of the pinned notes, if any)
  -> apkh-search /ai-search/rag
  -> answer + references (each marked semantic, keyword or both)
```

Details:

- **Hybrid** search catches exact terms embeddings blur (names, error codes), and is what keeps Claude users' search working.
- Semantic matches below a per-provider similarity (Gemini 0.5, OpenAI 0.3) are ignored; confidence is "high" from Gemini 0.7 / OpenAI 0.5, "medium" for keyword-only search.
- **Pinned notes** (`@mention`) restrict the search to those notes and skip the similarity cutoff, so broad questions ("what are the key points?") still get the note's content.
- If the query can't be embedded (e.g. a rate limit), the answer comes from keyword matches instead of failing.
- **Query rewrite**: when the first search is weak (no keyword match and nothing close in meaning), the model rewrites the question into a standalone search query with a few extra terms, and the results of both searches are merged. The answer shows what was also searched for. Clear questions never pay for this extra call.
- **Vector search in the database** (optional, Atlas only): with `ATLAS_VECTOR_INDEX` set (create the index with `npm run search:vector-index`), Atlas ranks the vectors instead of the API loading them. If it fails, the API falls back to its own scan and tries Atlas again 10 minutes later.
- The response includes `pendingNotes`: how many notes are still being indexed and weren't searched yet.
- Chat transcripts are never AI-search sources.

### Citations and source jump

The passages are sent to the model as numbered sources (`[1] Note "Plan" | File: q3.pdf | Page 2` followed by the text), and the prompt asks it to cite them inline as `[1]`, `[2][3]`. General knowledge is only allowed when labelled "From general knowledge:" and uncited. The API marks each reference `cited` when the answer contains its number.

In the web app every `[n]` is a button, and every source card opens the **source viewer**:

- a note passage opens the whole note, scrolled to the passage, which is highlighted (whitespace-insensitive matching; the CSS Custom Highlight API, with a `<mark>` fallback)
- an attachment passage opens the file, PDFs at the cited page (`#page=N`)

## 8. Chat

For each message the API assembles a small, ranked context with the same hybrid retrieval. A short follow-up that leans on the conversation ("and the budget for it?") is first rewritten into a standalone question for the search; the model still answers the question as asked. The context has up to 6 passages from notes and attachments, 3 from this conversation's indexed transcript, and 3 from other conversations, plus the last 10 messages. The answer is generated before anything is saved, so a failed answer leaves no unanswered question in the history.

Chat answers cite the note passages the same way. The passages are saved with the assistant message (`sources`, each marked `cited`), so citations still work when a conversation is reopened, and "Continue this conversation" carries over the AI answer's sources.

## 9. Summaries

- A cached summary is returned as-is (no tokens spent).
- Otherwise the note's chunks (note text + attachments, in order) are sent to `/ai-search/summarize`.
- While the note is being re-indexed, its current text is used instead of possibly stale chunks, and the result isn't cached.
- Failures ("model no longer available", ...) are never cached.
- Editing or deleting the note clears its cached summary.

## 10. Token Usage

`apkh-search` reports tokens for answers, summaries, image reads and embeddings (embedding tokens are counted locally, as the SDKs don't return them), and the API adds them to the active config's and the user's totals.

## 11. Startup Migrations

Before serving requests the API runs any migrations not yet recorded in `migrations`:

1. **object-id-refs**: id fields were declared in a way Mongoose treated as untyped, so notes stored `userId` as a string; they become real ObjectIds.
2. **chunks-v2**: hashes every chunk's text; converts existing OpenAI vectors (already in today's OpenAI space) to binary vectors; drops old Gemini vectors (3072 dimensions, not comparable with the 1536 space) so those notes are re-embedded from their stored text; removes old chat-transcript chunks, which are rebuilt.
3. **note-plain-text**: recomputes `contentPlain` with one line per paragraph.

Each is safe to re-run. Notes indexed before the queue existed get their jobs the first time the user opens the app (a background "reconcile" also queues anything missing or in the wrong space).

## 12. Short Version

```text
Indexing:   note save -> index_jobs -> worker -> extract (new files only) -> chunk -> embed (new text only) -> knowledgechunks
AI search:  query -> [embed] -> hybrid retrieval (meaning + keywords) -> RAG answer + references
Chat:       message -> [embed] -> notes + this chat + other chats (ranked, capped) -> answer -> saved
Summary:    cache hit? -> else note chunks -> summarize -> cache
```

## 13. Diagrams

### Indexing

```text
Web  --save note-->  apkh-api  --queue-->  index_jobs
                                              |
                          index worker  <-----+
                              |
                              +--> apkh-search /ingest/extract --> apkh-storage (attachments)
                              |                                --> vision model (images, scans)
                              +--> apkh-search /ingest/chunk
                              +--> apkh-search /ingest/embed   --> embedding model
                              |
                              +--> knowledgechunks (text, textHash, space, vector)
```

### AI search and chat

```text
Web --> apkh-api --> apkh-search /ai-search/embed-query --> embedding model
            |
            +--> knowledgechunks: vector similarity  +  text search  --> fused ranking
            |
            +--> apkh-search /ai-search/rag or /chat-rag --> chat model
            |
            +--> answer + references --> Web
```
