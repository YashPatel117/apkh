# AI-Powered Personal Knowledge Hub — AI Flow Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Module Responsibilities](#module-responsibilities)
4. [Ingestion Pipeline (Note Upsert Flow)](#ingestion-pipeline)
5. [Content Extraction Strategy](#content-extraction-strategy)
6. [Embedding & Vector Storage](#embedding--vector-storage)
7. [AI Search Flow](#ai-search-flow)
8. [Data Models & Schema](#data-models--schema)
9. [API Contracts](#api-contracts)
10. [Technology Recommendations](#technology-recommendations)
11. [Error Handling & Edge Cases](#error-handling--edge-cases)
12. [Future Considerations](#future-considerations)

---

## 1. Project Overview

**AI-Powered Personal Knowledge Hub** is a note-taking application where users can store rich notes containing text, links, images, and file attachments. The AI layer adds semantic understanding on top of these notes — allowing users to ask natural language questions and get grounded, referenced answers sourced directly from their own stored knowledge.

### Core User Stories

| # | Story |
|---|-------|
| 1 | User writes/updates a note → system automatically indexes it for AI search |
| 2 | User types a query in the search bar → normal text-based search returns matching notes |
| 3 | User clicks the **AI button** on the search bar → gets a synthesized answer with references back to the exact notes (and files) it came from |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          UI Module                              │
│   Rich Text Editor (Quill.js) + File Uploader + Search Bar     │
│                     + AI Answer Panel                           │
└───────────────────┬─────────────────────────┬───────────────────┘
                    │ Note Upsert              │ Search / AI Query
                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Module                              │
│   REST endpoints for Notes CRUD + Trigger Ingestion Pipeline   │
│                  + Handle Search Queries                        │
└───────┬───────────────────────┬─────────────────────┬──────────┘
        │                       │                     │
        ▼                       ▼                     ▼
┌───────────────┐   ┌───────────────────┐   ┌─────────────────────┐
│  Store Module │   │  Search Module    │   │   AI/LLM Service    │
│               │   │                  │   │  (OpenAI / Gemini / │
│ - Raw files   │   │ - Vector DB      │   │   local model)      │
│   (PDF, img,  │   │ - Chunk store    │   │                     │
│   etc.)       │   │ - Embeddings     │   │ - Embeddings API    │
│ - Object      │   │ - Full-text idx  │   │ - Chat/RAG API      │
│   storage     │   │                  │   │                     │
└───────────────┘   └───────────────────┘   └─────────────────────┘
```

**Data flow summary:**
- **Write path:** UI → API → Store (raw file) + AI Ingestion Pipeline → Search (vectors)
- **Read path (text search):** UI → API → Search (full-text) → UI
- **Read path (AI search):** UI → API → Search (vector similarity) → LLM (RAG) → UI (answer + references)

---

## 3. Module Responsibilities

### UI Module *(already built)*
- Quill.js rich text editor
- File attachment with custom `file-token` spans
- Search bar with normal search + AI toggle button
- Renders AI answer panel with source references

### API Module *(already built)*
- CRUD for notes
- File upload proxy to Store
- **NEW:** Triggers the ingestion pipeline on every note upsert
- **NEW:** Exposes `/search` and `/ai-search` endpoints

### Store Module *(already built)*
- Object/blob storage for raw files (PDFs, images, etc.)
- File retrieval by ID

### Search Module *(to be built)*
- Receives processed chunks + embeddings from the ingestion pipeline
- Stores them in a vector database
- Answers similarity queries (top-K relevant chunks)
- Optionally supports full-text search alongside vector search

---

## 4. Ingestion Pipeline

This pipeline runs every time a note is **created or updated**. It must be **asynchronous** — the API should acknowledge the upsert immediately, then process in the background.

```
Note Upsert Event
       │
       ▼
┌─────────────────────┐
│  1. Parse Note HTML  │   Strip Quill HTML → plain text blocks, links, file tokens
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  2. Extract Files   │   For each file-token, fetch file from Store
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Per-file Content Extraction (parallel)                  │
│                                                             │
│   PDF  ──► extract text pages + OCR fallback               │
│   Image ──► vision model caption / OCR                     │
│   .txt / .md ──► read directly                             │
│   .docx / .xlsx ──► parse to plain text                    │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│  4. Combine Content │   Merge note text + file-extracted text
│     into one doc    │   Label each section with its source
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  5. Chunking        │   Split into overlapping chunks (e.g. 512 tokens, 64 overlap)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  6. Embed Chunks    │   Send each chunk to embedding model → get vector
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  7. Upsert to       │   Store vectors + metadata in vector DB
│     Vector DB       │   Delete old chunks for this note first (clean re-index)
└─────────────────────┘
```

### Step-by-step detail

#### Step 1 — Parse Note HTML

The note body is Quill HTML. Parse it to extract:

- **Plain text** (strip all HTML tags, decode entities)
- **Links** (href value + anchor text)
- **File tokens** (data-id and data-name attributes from `.file-token` spans)

```
Input:
  <p>My notes on Angular</p>
  <a href="chatgpt.com">reference</a>
  <span class="file-token" data-id="123-abc" data-name="angular.pdf">angular.pdf</span>

Output:
  text_content   = "My notes on Angular\nreference"
  links          = [{ href: "chatgpt.com", text: "reference" }]
  file_tokens    = [{ id: "123-abc", name: "angular.pdf" }]
```

#### Step 2 — Extract Files

For each `file_token`, fetch the raw file bytes from the Store module using the file ID.

#### Step 3 — Per-file Content Extraction

| File Type | Strategy |
|-----------|----------|
| `.pdf` | Extract text per page using a PDF parser (pdfjs / pdfplumber / PyMuPDF). If text is empty or very short on a page → treat as scanned → apply OCR |
| `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Send to a vision model (GPT-4o Vision, Gemini Vision, or Tesseract OCR) → get description + any visible text |
| `.txt`, `.md` | Read file content directly |
| `.docx` | Parse with mammoth or similar → extract plain text |
| `.xlsx`, `.csv` | Parse rows/columns → convert to a readable text representation |
| Other formats | Skip silently, log a warning |

Each extraction result carries metadata:
```json
{
  "file_id": "123-abc",
  "file_name": "angular.pdf",
  "extracted_text": "Angular is a platform...",
  "page_count": 5,
  "extraction_method": "pdf_text"
}
```

#### Step 4 — Combine into One Document

Assemble the final document with labeled sections:

```
[NOTE TEXT]
My notes on Angular
reference (link: chatgpt.com)

[FILE: angular.pdf]
Angular is a platform and framework for building client applications...
... (page 1) ...
... (page 2) ...
```

Label source clearly so it can be traced back later.

#### Step 5 — Chunking

Split the combined document into overlapping fixed-size chunks.

| Parameter | Recommended Value |
|-----------|------------------|
| Chunk size | 512 tokens |
| Overlap | 64 tokens |
| Splitter | Sentence-aware (don't cut mid-sentence) |

Each chunk carries metadata:
```json
{
  "chunk_id": "note_42_chunk_3",
  "note_id": "42",
  "note_title": "Angular Notes",
  "source_type": "file",
  "source_name": "angular.pdf",
  "source_page": 2,
  "text": "Angular is a platform...",
  "char_start": 1024,
  "char_end": 1536
}
```

`source_type` can be `"note"` (from the note's own text) or `"file"` (from an attached file).

#### Step 6 — Generate Embeddings

Send each chunk's `text` to the embedding model. Recommended models:

| Provider | Model | Dimensions | Notes |
|----------|-------|-----------|-------|
| OpenAI | `text-embedding-3-small` | 1536 | Fast, cheap, good quality |
| OpenAI | `text-embedding-3-large` | 3072 | Best quality, higher cost |
| Google | `text-embedding-004` | 768 | Good for Gemini-based stack |
| Local | `nomic-embed-text` via Ollama | 768 | Fully private, free |

Batch chunks (e.g. 100 at a time) to minimize API round trips.

#### Step 7 — Upsert to Vector DB

Before inserting new vectors for a note, **delete all existing vectors** with that `note_id` to avoid stale duplicates.

Then insert:
```json
{
  "id": "note_42_chunk_3",
  "vector": [0.012, -0.453, ...],
  "metadata": {
    "note_id": "42",
    "note_title": "Angular Notes",
    "source_type": "file",
    "source_name": "angular.pdf",
    "source_page": 2,
    "text": "Angular is a platform..."
  }
}
```

---

## 5. Content Extraction Strategy

### PDF Extraction Decision Tree

```
PDF received
     │
     ▼
Extract text using PDF parser
     │
     ├── text length > threshold? ──► Use extracted text directly
     │
     └── text too short / empty?
              │
              ▼
         Rasterize page to image
              │
              ▼
         Run OCR (Tesseract or vision model API)
              │
              ▼
         Use OCR text
```

### Image Extraction

Send image to a vision-capable LLM with the prompt:
```
Describe all visible text and content in this image in detail.
Include any tables, diagrams, headings, paragraphs, and captions.
Format the output as plain text, preserving logical structure.
```

The response becomes the chunk content for that image.

### Chunking Nuance for Files

For PDFs, chunk **per page first**, then apply token-size chunking within each page. This preserves page-level metadata (page number) for better references.

```
Page 1 text → [chunk_p1_1, chunk_p1_2]
Page 2 text → [chunk_p2_1]
...
```

---

## 6. Embedding & Vector Storage

### Vector Database Options

| DB | Hosting | Best For |
|----|---------|----------|
| **Pinecone** | Cloud (managed) | Simplest to start, no infra |
| **Qdrant** | Self-hosted / Cloud | Full control, great metadata filtering |
| **Weaviate** | Self-hosted / Cloud | Built-in hybrid (vector + keyword) search |
| **pgvector** | PostgreSQL extension | Already using Postgres? Easiest addition |
| **Chroma** | Local / embedded | Development and small-scale use |

**Recommendation:** If you want simple and fast to ship → **Pinecone**. If you want self-hosted and full control → **Qdrant**.

### Index Schema (Qdrant example)

Collection: `knowledge_chunks`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique chunk ID |
| `vector` | float[] | Embedding vector |
| `note_id` | string | Parent note ID |
| `note_title` | string | Note title (for display) |
| `user_id` | string | Owner (for multi-user isolation) |
| `source_type` | enum | `note` or `file` |
| `source_name` | string | File name if source_type=file |
| `source_page` | integer | Page number if PDF |
| `text` | string | Raw chunk text (for display in references) |
| `created_at` | datetime | Indexing timestamp |

### Filtering

Always filter by `user_id` on every vector query — users must only see their own knowledge.

---

## 7. AI Search Flow

This is what happens when the user clicks the **AI button** and submits a query.

```
User types query + clicks AI button
              │
              ▼
┌─────────────────────────┐
│  1. Embed the Query     │   Same embedding model as ingestion
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Vector Similarity Search                                    │
│     Query the vector DB for top-K most similar chunks          │
│     Filter: user_id = current user                             │
│     K = 5 to 10 chunks                                         │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│  3. Re-rank (optional)  │   Use a cross-encoder or MMR to
│                         │   de-duplicate and improve relevance
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Build RAG Prompt                                            │
│                                                                 │
│  System: "You are a personal knowledge assistant. Answer only  │
│  based on the context provided. If the answer is not in the    │
│  context, say so. Always cite which note and file each piece   │
│  of information comes from."                                   │
│                                                                 │
│  Context: [chunk 1 text] [Source: Angular Notes / angular.pdf] │
│           [chunk 2 text] [Source: Meeting Notes]               │
│           ...                                                   │
│                                                                 │
│  User: {user's original query}                                 │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│  5. Call LLM            │   GPT-4o / Gemini / Claude / local
│  (streaming recommended)│
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Compose Response                                            │
│                                                                 │
│  {                                                              │
│    "answer": "Angular is a platform...",                       │
│    "references": [                                             │
│      {                                                         │
│        "note_id": "42",                                        │
│        "note_title": "Angular Notes",                          │
│        "source_type": "file",                                  │
│        "source_name": "angular.pdf",                           │
│        "source_page": 2,                                       │
│        "excerpt": "Angular is a platform and framework..."     │
│      }                                                         │
│    ]                                                           │
│  }                                                             │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
       Render in UI
  (answer text + clickable reference cards)
```

### RAG Prompt Template

```
System:
You are a personal knowledge assistant. Your job is to answer the user's question
using ONLY the information in the provided context sections.

Rules:
- If the answer is clearly present in the context, answer it directly.
- If the answer is partially present, answer what you can and note what is missing.
- If the answer is not in the context at all, say: "I couldn't find information about
  this in your notes."
- Do not make up or infer information not present in the context.
- Be concise. Prefer bullet points for multi-part answers.

Context:
---
[SOURCE: Note "Angular Notes" | File: angular.pdf | Page 2]
Angular is a platform and framework for building single-page client applications...

[SOURCE: Note "Meeting Notes — Oct 12"]
We decided to migrate from AngularJS to Angular 17 by Q1...
---

User question: {query}
```

### Confidence & Fallback

If the similarity scores of retrieved chunks are all below a threshold (e.g. cosine similarity < 0.35), return a "low confidence" flag to the UI. The UI can then show:

> *"Your notes don't seem to contain information on this topic. Here are the closest matches I found:"* → show note titles

---

## 8. Data Models & Schema

### Note (existing, extended)

```typescript
interface Note {
  id: string
  user_id: string
  title: string
  body: string           // Raw Quill HTML
  created_at: Date
  updated_at: Date
  file_ids: string[]     // IDs of attached files
  indexed_at?: Date      // When AI indexing last completed
  index_status: 'pending' | 'processing' | 'done' | 'error'
}
```

### Chunk (new — stored in vector DB metadata)

```typescript
interface Chunk {
  chunk_id: string       // e.g. "note_42_chunk_3"
  note_id: string
  note_title: string
  user_id: string
  source_type: 'note' | 'file'
  source_name?: string   // filename if source_type = 'file'
  source_page?: number   // page number if PDF
  text: string           // raw text of the chunk
  embedding: number[]    // stored in vector DB
  created_at: Date
}
```

### AI Search Response

```typescript
interface AISearchResponse {
  query: string
  answer: string
  confidence: 'high' | 'medium' | 'low' | 'not_found'
  references: Reference[]
}

interface Reference {
  note_id: string
  note_title: string
  source_type: 'note' | 'file'
  source_name?: string
  source_page?: number
  excerpt: string           // relevant chunk text to preview
  similarity_score: number  // 0.0 to 1.0
}
```

---

## 9. API Contracts

### Trigger Ingestion (internal — called by API on note upsert)

```
POST /internal/ingest
Body: { note_id: string }

Response: 202 Accepted
```

This endpoint should push the job to a background queue (e.g. BullMQ, Celery, or a simple worker). The HTTP response should NOT wait for indexing to complete.

### Normal Search

```
GET /search?q={query}&user_id={user_id}

Response 200:
{
  "results": [
    {
      "note_id": "42",
      "note_title": "Angular Notes",
      "excerpt": "...",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### AI Search

```
POST /ai-search
Body:
{
  "query": "What is Angular used for?",
  "user_id": "user_123",
  "top_k": 5
}

Response 200:
{
  "query": "What is Angular used for?",
  "answer": "Angular is a platform for building client-side web applications...",
  "confidence": "high",
  "references": [
    {
      "note_id": "42",
      "note_title": "Angular Notes",
      "source_type": "file",
      "source_name": "angular.pdf",
      "source_page": 2,
      "excerpt": "Angular is a platform and framework for building...",
      "similarity_score": 0.92
    },
    {
      "note_id": "67",
      "note_title": "Meeting Notes — Oct 12",
      "source_type": "note",
      "excerpt": "We decided to migrate to Angular 17...",
      "similarity_score": 0.78
    }
  ]
}
```

Optionally, stream the `answer` field using Server-Sent Events (SSE) while `references` come at the end.

### Get Indexing Status

```
GET /notes/{note_id}/index-status

Response 200:
{
  "note_id": "42",
  "index_status": "done",
  "indexed_at": "2024-01-01T00:05:00Z",
  "chunk_count": 12
}
```

---

## 10. Technology Recommendations

### Embedding Model
- **Start with:** OpenAI `text-embedding-3-small` — cheap (~$0.00002/1K tokens), fast, good quality
- **Alternative (free/private):** `nomic-embed-text` via Ollama running locally

### LLM for Answer Generation
- **Start with:** OpenAI `gpt-4o-mini` — best cost-to-quality ratio
- **Alternative:** Google `gemini-1.5-flash`, or Anthropic `claude-3-haiku`

### Vector Database
- **Simplest to deploy:** Pinecone (cloud, no infra)
- **Best self-hosted:** Qdrant (Docker image, great filtering support)
- **If already using Postgres:** `pgvector` extension (minimal new infra)

### PDF Parsing
- **Node.js:** `pdf-parse` or `pdfjs-dist`
- **Python:** `PyMuPDF` (fitz) or `pdfplumber`

### OCR
- **Free/local:** Tesseract via `tesseract.js` (Node) or `pytesseract` (Python)
- **Cloud (better accuracy):** Google Cloud Vision API, AWS Textract

### Background Jobs
- **Node.js:** BullMQ + Redis
- **Python:** Celery + Redis or RQ

### Recommended Tech Stack Summary

| Component | Tool |
|-----------|------|
| Embedding | OpenAI `text-embedding-3-small` |
| LLM | OpenAI `gpt-4o-mini` |
| Vector DB | Qdrant (Docker) or Pinecone |
| PDF parse | `PyMuPDF` or `pdf-parse` |
| OCR | Tesseract (free) or Google Vision |
| Image understanding | GPT-4o Vision |
| Job queue | BullMQ + Redis |
| Full-text search | Elasticsearch or Postgres FTS |

---

## 11. Error Handling & Edge Cases

| Case | Handling |
|------|----------|
| File extraction fails | Log error, skip that file, index rest of note. Mark chunk source as `extraction_failed`. |
| Embedding API is down | Retry with exponential backoff (3 attempts). If still failing, mark note as `index_status: error` and requeue. |
| Note deleted | Delete all chunks with that `note_id` from vector DB. |
| Note has no text or files | Store a minimal chunk with just the title so the note is still discoverable. |
| Very large PDF (100+ pages) | Process in batches of 20 pages. Set a max page limit (e.g. 200 pages) and warn user if exceeded. |
| Query returns no results above threshold | Return `confidence: not_found` — do NOT hallucinate an answer. |
| User updates note | Re-trigger full ingestion (delete old chunks, re-index). |
| Concurrent upserts for same note | Use a queue with deduplication key = `note_id` so only one job runs at a time per note. |

---

## 12. Future Considerations

### Hybrid Search
Combine vector similarity with traditional full-text keyword search (BM25) for better results on exact-match queries. Qdrant and Weaviate support this natively. Weight the scores 70% vector + 30% BM25.

### Note Graph / Linking
Store detected links between notes. If Note A references Note B's content (or a shared file), expose this in references.

### Conversation Memory
Allow follow-up questions in AI search ("Tell me more about the deployment part"). Maintain a short conversation history in the request.

### Incremental Re-indexing
Instead of full re-index on every edit, detect which sections of the note changed (diff the HTML) and only re-embed modified chunks.

### Private File Summaries
Store an LLM-generated summary of each file separately (not chunked). Use this summary as a quick lookup before doing full chunk retrieval — useful for "what files do I have about X?" type queries.

### User Feedback Loop
Let users mark AI answers as helpful / not helpful. Log which chunks were used. Over time, use this to improve retrieval ranking.

---

## Quick-Start Checklist for the Search Module

- [ ] Set up vector DB (Qdrant via Docker or Pinecone free tier)
- [ ] Build HTML parser to extract text, links, file tokens from Quill HTML
- [ ] Build per-filetype content extractors (PDF, image, txt)
- [ ] Build chunker with metadata tagging
- [ ] Integrate embedding model API
- [ ] Build upsert-to-vector-DB function with delete-before-insert logic
- [ ] Wire ingestion trigger from API on note save (background queue)
- [ ] Build `/ai-search` endpoint with vector lookup + RAG prompt
- [ ] Build reference response structure
- [ ] Integrate into UI search bar with AI toggle
- [ ] Add `index_status` field to notes and surface it in UI

---

*Document version: 1.0 | Project: AI-Powered Personal Knowledge Hub | Module: Search (AI Flow)*
