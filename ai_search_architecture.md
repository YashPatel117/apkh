# AI-Powered Personal Knowledge Hub

## API <-> Search <-> AI Model Flow

This document explains how the `apkh-api` and `apkh-search` projects communicate, what data is stored, what gets indexed, how AI search works, and how note summaries are created.

The goal is to make the backend AI flow easy to understand without needing to read every file again.

## 1. Main Responsibilities

### `apkh-api`

This is the orchestration layer.

It is responsible for:

- saving notes in MongoDB
- saving and loading file names through `apkh-storage`
- reading the user's active AI config
- triggering ingestion/indexing after note create or update
- storing indexed chunks in MongoDB
- running semantic search over stored embeddings
- caching summaries in MongoDB
- tracking token usage

### `apkh-search`

This is the AI processing engine.

It is responsible for:

- parsing note HTML into plain text
- extracting text from attached files
- chunking note/file text into smaller parts
- generating embeddings for chunks
- generating one embedding for the user's search query
- calling the final LLM for RAG answers
- calling the final LLM for note summaries

### AI Provider

This is OpenAI, Gemini, or Anthropic depending on the active model.

The provider is only called for:

- embedding generation
- final answer generation
- final summary generation

The provider does not directly query your MongoDB or your notes database.

## 2. What Is Stored

### Notes collection

MongoDB stores the original note data:

- `title`
- `content` as HTML
- `contentPlain`
- `category`
- timestamps

This is defined in `apkh-api/src/common/schema/note.ts`.

### File storage

Attached files are stored by `apkh-storage` on disk.

Examples:

- PDFs
- images
- DOCX
- XLSX
- CSV
- TXT

The file bytes are not stored in MongoDB by the API project.

### KnowledgeChunk collection

MongoDB also stores indexed chunk documents for AI search.

Each chunk stores:

- `noteId`
- `userId`
- `noteTitle`
- `chunkIndex`
- `text`
- `sourceType`
- `sourceName`
- `sourcePage`
- `embeddingProvider`
- `embeddingModel`
- `embedding`

This is defined in `apkh-api/src/common/schema/chunk.ts`.

This collection is the core of semantic search.

### Summary collection

MongoDB stores generated summaries in a separate `summary` collection.

Each summary stores:

- `noteId`
- `userId`
- `summary`
- `summaryModel`
- its own `createdAt`
- its own `updatedAt`

This is defined in `apkh-api/src/common/schema/summary.ts`.

This is why clicking the Summary button does not update the note's `updatedAt`.

## 3. Where API Key and Model Come From

The user saves one or more LLM configs in the API project.

Each config contains:

- key name
- encrypted API key
- model
- active/inactive status

When the API needs AI features, it reads the active config from `UsersService`.

Flow:

1. user saves AI config in `apkh-api`
2. API stores the key encrypted
3. API decrypts the active key only when needed
4. API sends `api_key` and `model` to `apkh-search`
5. `apkh-search` uses them for embeddings or final LLM calls

The search project does not permanently store user provider keys.

## 4. Two Different Search Systems

This project has two separate search paths.

### A. Normal search

This uses MongoDB text search on:

- note title
- note category
- `contentPlain`

This is the standard search endpoint and does not use embeddings.

### B. AI search

This uses semantic similarity over stored chunk embeddings.

This path:

- embeds the user's question
- compares that embedding with stored chunk embeddings
- picks the most relevant chunks
- sends those chunks to the LLM
- returns an answer with references

So normal search and AI search are different systems.

## 5. Ingestion / Indexing Flow

This happens after note create or note update.

### Step 1: Note is saved in API

`apkh-api` saves the note and uploads files first.

Then it triggers ingestion in the background.

That means the user does not wait for indexing to finish before the save completes.

### Step 2: API calls Search `/ingest`

`apkh-api` sends this to `apkh-search`:

- `note_id`
- `user_id`
- `title`
- `content`
- `files`
- `api_key`
- `model`

This call is made from `SearchService.processIngestion()`.

### Step 3: Search parses note HTML

`apkh-search` uses `html_parser.py` to convert the note HTML into plain text.

It extracts:

- visible text
- links
- file-token spans

Important detail:

- file token spans are removed from plain text so they do not pollute embeddings
- links are preserved as structured link lines and appended to the note text

### Step 4: Search fetches attached files from storage

If the note has files, `apkh-search` calls `apkh-storage` for each file using:

- note id
- filename
- auth header

This happens in `_fetch_and_extract_files()` in `apkh-search/routes/ingest.py`.

### Step 5: Search extracts text from files

`file_extractor.py` extracts usable text.

Supported flows:

- PDF text extraction with PyMuPDF
- PDF OCR fallback if page text is too short
- image OCR using Tesseract
- DOCX text extraction
- XLSX extraction
- CSV extraction
- TXT and Markdown direct reading

Important limitation:

- images are handled as OCR text extraction, not full image understanding
- if an image has no readable text, it contributes little or nothing

### Step 6: Search creates chunks

After note text and file text are ready, `chunker.py` splits the content into smaller chunks.

Current chunking behavior:

- token-aware chunking
- sentence-aware splitting
- chunk size: `512` tokens
- overlap: `64` tokens

Why chunking exists:

- large notes/files are too big to embed and retrieve as one block
- smaller chunks improve retrieval quality
- overlap reduces the chance of losing context between chunk boundaries

### Step 7: Search generates embeddings

For every chunk text, `apkh-search` asks an embedding model for a vector.

This happens in `embedder.py`.

Provider behavior:

- Gemini embeddings use `gemini-embedding-001`
- OpenAI embeddings use `text-embedding-3-small`
- Anthropic is not supported for embeddings in this project

Important:

- the user's active model determines the provider
- but the actual embedding model used is fixed by provider

### Step 8: API stores the chunks

`apkh-search` returns all chunks with embeddings to `apkh-api`.

Then `apkh-api`:

1. deletes old chunks for that note
2. inserts the fresh chunk list into MongoDB

That means the long-term searchable vector data lives in MongoDB inside the API project database.

## 6. What an Embedding Actually Is

An embedding is a list of numbers representing the meaning of a piece of text.

You can think of it like this:

- similar meaning -> vectors are closer
- unrelated meaning -> vectors are farther apart

Examples:

- "meeting tomorrow at 5" and "tomorrow's meeting is at 5 PM" will be close
- "banana smoothie recipe" will be far from them

Important:

- embeddings are not human-readable summaries
- embeddings are not the original text
- embeddings help find relevant text, but they cannot reconstruct the original content by themselves

That is why your app stores both:

- the original chunk text
- the embedding vector for that text

## 7. AI Search Flow

This is the flow when the user uses AI search.

### Step 1: API receives the search query

The web app calls `POST /notes/ai-search`.

`apkh-api` receives the user query.

### Step 2: API gets active AI config

The API reads the active user config from `UsersService`.

If there is no active config:

- AI search cannot run

If the active provider is Anthropic:

- semantic search cannot run because embeddings are not supported in this project for Anthropic

### Step 3: API asks Search to embed the query

`apkh-api` sends the user's query text to:

- `apkh-search /ai-search/embed-query`

The search service returns one embedding vector for the query.

### Step 4: API loads all relevant stored chunks

`apkh-api` reads the user's indexed chunks from MongoDB.

It also filters by compatible embedding provider so vector spaces are not mixed incorrectly.

This is important because:

- OpenAI embeddings should be compared with OpenAI embeddings
- Gemini embeddings should be compared with Gemini embeddings

### Step 5: API calculates similarity

`apkh-api` performs cosine similarity in code between:

- the query embedding
- each stored chunk embedding

Then it:

- scores each chunk
- filters weak matches
- sorts by score
- keeps the top chunks

Important detail:

- this project is not using Pinecone, FAISS, or Atlas vector search right now
- embeddings are stored in MongoDB
- similarity search itself runs inside the API process

### Step 6: API sends top contexts to Search for final answer generation

`apkh-api` builds context strings like:

- note title
- file name
- page number
- chunk text

Then it sends them to:

- `apkh-search /ai-search/rag`

### Step 7: Search calls the LLM

`apkh-search` builds a strict prompt telling the model:

- only use the provided context
- do not invent facts
- say when information is missing

Then it calls the active provider:

- Gemini
- OpenAI
- Anthropic

Anthropic can be used here because this step is answer generation, not embedding generation.

### Step 8: API returns answer + references

`apkh-search` returns:

- final answer
- token usage

`apkh-api`:

- stores token usage against the active config
- returns answer + references to the web app

## 8. Summary Flow

This is the flow when the user clicks the Summary button for one note.

### Step 1: API checks summary cache

`apkh-api` looks in the `summary` collection for:

- `noteId`
- `userId`

If a summary exists:

- it returns that cached summary immediately
- no extra LLM tokens are spent

### Step 2: API gathers indexed chunks for that note

If there is no cached summary, the API loads all stored chunks for that note from the `KnowledgeChunk` collection.

These chunks may include:

- note body chunks
- attachment chunks
- PDF page chunks
- OCR-derived image text chunks

### Step 3: API handles indexing-not-ready cases

If the note has attachments but chunk indexing is not ready yet, the API returns a temporary message:

- attachment text is still being indexed

This is not cached as a final summary.

### Step 4: API builds summary contexts

The API converts the note's chunks into ordered context blocks such as:

- note content
- attachment filename
- attachment page number

This preserves structure for the summarizer.

### Step 5: API calls Search `/summarize`

`apkh-api` sends:

- note title
- category
- content
- indexed contexts
- `api_key`
- `model`

to:

- `apkh-search /ai-search/summarize`

### Step 6: Search calls the LLM for a compact summary

`apkh-search` builds a summary prompt with rules like:

- keep it compact
- focus on main ideas
- include tasks, dates, decisions, and links
- do not invent details
- keep it under 120 words

Then it calls the active LLM provider.

### Step 7: API stores summary cache

If the result is cacheable, `apkh-api` stores it in the `summary` collection.

That way:

- the next summary click does not spend tokens
- the note's own `updatedAt` is unchanged

### Step 8: Cache is cleared on note update

Whenever the note is updated or deleted:

- the related summary document is removed

This prevents stale summaries from surviving note edits.

## 9. What Is Searched and On What

### Normal search searches on:

- note title
- note category
- plain text version of note HTML

This uses Mongo text indexes.

### AI search searches on:

- stored chunk embeddings

Those chunks come from:

- note text
- note links
- extracted file text
- OCR text from images or scanned PDFs

AI search does not search directly on raw HTML or raw file bytes.

### Summary uses:

- all stored chunks for one note

It does not perform top-k similarity retrieval like AI search.

Instead it gathers the full note context and summarizes that single note.

## 10. Why Reindexing Happens

Reindexing happens when:

- a note is created
- a note is updated
- the active LLM config changes

Why active-config changes trigger reindexing:

- embeddings from different providers are not safely comparable
- if the user switches from Gemini to OpenAI, the stored vectors need to be regenerated in the new provider's vector space

So `apkh-api` triggers full user reindexing when the active config changes.

## 11. Token Usage Tracking

`apkh-search` returns `tokens_used` for:

- RAG answers
- summaries

Then `apkh-api` increments:

- the user's total token count
- the active config's token usage

This tracking happens in `UsersService.addTokenUsage()`.

## 12. End-to-End Mental Model

The simplest mental model is:

- `apkh-api` stores data and orchestrates workflows
- `apkh-search` transforms note/file text into embeddings and LLM outputs
- MongoDB stores the long-term note, chunk, and summary data
- `apkh-storage` holds the raw files
- the AI provider only sees prompt text and chunk text sent for a request

## 13. Short Version

### Ingestion

`note save -> API -> Search parse/extract/chunk/embed -> API stores chunks in MongoDB`

### AI Search

`user query -> API -> Search embeds query -> API compares with stored chunk embeddings -> API sends best chunks to Search -> Search calls LLM -> API returns answer`

### Summary

`summary click -> API checks summary cache -> if missing, API loads note chunks -> API sends contexts to Search -> Search calls LLM -> API stores summary cache -> API returns summary`

## 14. Diagrams

### A. Ingestion / Indexing

```text
Web
  -> apkh-api (save note + files)
  -> apkh-storage (store raw files)
  -> apkh-api SearchService.triggerIngestion()
  -> apkh-search /ingest
       -> parse note HTML
       -> fetch files from apkh-storage
       -> extract text from files
       -> chunk note/file text
       -> generate embeddings via provider
  -> apkh-api receives chunks + embeddings
  -> MongoDB KnowledgeChunk collection
```

### B. AI Search

```text
Web
  -> apkh-api /notes/ai-search
  -> apkh-api loads active AI config
  -> apkh-search /ai-search/embed-query
       -> generate embedding for user query
  -> apkh-api loads KnowledgeChunk docs from MongoDB
  -> apkh-api cosine similarity over stored embeddings
  -> apkh-api picks top matching chunks
  -> apkh-search /ai-search/rag
       -> build RAG prompt from top chunks
       -> call Gemini / OpenAI / Anthropic
  -> apkh-api stores token usage
  -> Web receives answer + references
```

### C. Summary

```text
Web
  -> apkh-api /notes/:id/summary
  -> apkh-api checks MongoDB summary collection
     -> if cached, return immediately
     -> if not cached:
          -> load KnowledgeChunk docs for that note
          -> build summary contexts
          -> apkh-search /ai-search/summarize
               -> build summary prompt
               -> call Gemini / OpenAI / Anthropic
          -> apkh-api stores summary in MongoDB summary collection
  -> Web receives summary
```

### D. One-Line Architecture

```text
Web -> API -> Search -> AI Provider
         |      ^
         v      |
     MongoDB    |
         |
         v
    Stored note / chunks / summaries

Search <-> Storage
          raw attached files
```
