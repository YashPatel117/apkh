# Plans

> **Search + clarity + actionability first.** If users can *find*, *trust* and *act* on their notes, retention follows. Graph and visual features look impressive but don't drive daily use early on.

## Up next

### Free AI follow-ups
- Tune the free AI's similarity thresholds (search 0.45 / 0.6, similar notes 0.5) on real notes. A first test (5 notes, 7 queries) scored relevant passages 0.54–0.69 and unrelated ones at most 0.44.
- Lower the embedding model's memory: with the 8K context window Ollama loads it at about 2.9 GB, though embeddings need far less context.
- Streaming answers (below) matter most here: a CPU model takes 10–30 seconds per answer.
- Show waiting users their place in the queue when the free AI is busy.

### Free semantic search on OpenRouter
OpenRouter keys without credit get keyword search only (its embedding model is paid). Now that the free AI exists, an OpenRouter user could embed with the free AI's Qwen3-Embedding instead, while answering with their OpenRouter model.

### Account
- Real forgot-password flow (email link or OTP). Resetting currently requires the current password.

### Answers
- Streaming answers (tokens as they arrive) for AI search and chat.
- Answer feedback (helpful / not helpful). `apkh-search` already has a `/feedback` endpoint that records it in LangSmith; the UI and API don't use it yet.

## Roadmap

### 🟢 Phase 1: MVP (daily usefulness)

- [x] Ask-this-note (scoped Q&A on a note + attachments)
- [x] Action items extraction (tasks, deadlines, people, decisions)
- [x] Summary modes (brief + action items first)
- [x] Auto-generated titles
- [x] Hybrid search (keyword + semantic)
- [x] Query rewrite for vague queries
- [x] Indexing status (indexing / ready / failed)
- [x] Source jump (deep link to the exact passage or file page)

### 🟡 Phase 2: Engagement and retention

- [ ] Auto tags and categories
- [x] Similar notes (related + near-duplicates)
- [ ] Collections / folders
- [x] Pinned insights (save an AI answer as a note)
- [ ] Explain why this matched (search transparency)
- [ ] Daily digest / recent activity

### 🔵 Phase 3: Power features

- [x] Attachment-aware chat across all notes
- [ ] Vision for charts, diagrams and screenshots (images are already transcribed and described for search)
- [ ] Backlinks between notes
- [ ] Knowledge graph view
- [ ] Saved searches
- [ ] Smart filters

### 🟣 Phase 4: Scale and ops

- [ ] Export (Markdown / PDF)
- [ ] Share read-only links
- [x] Background queue + retry system
- [x] Reindex button
- [x] Database-side vector search (Atlas `$vectorSearch`, in-API fallback)
- [x] Free built-in AI, no key needed (self-hosted Qwen3.5 4B + Qwen3-Embedding-0.6B via Ollama)
- [ ] Usage dashboard (tokens, model usage)
