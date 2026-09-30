# Plans

> **Search + clarity + actionability first.** If users can *find*, *trust* and *act* on their notes, retention follows. Graph and visual features look impressive but don't drive daily use early on.

## Up next

### OpenRouter as a provider
Replace the "Custom" model option with **OpenRouter**, placed first in the provider list.
- Live model list from `GET https://openrouter.ai/api/v1/models` (public, no key needed; filterable by output modality; includes input modalities, pricing, context length).
- Chat through the existing `langchain-openai` package pointed at `https://openrouter.ai/api/v1`; no new dependency.
- Embeddings through OpenRouter's OpenAI-compatible `/api/v1/embeddings` with `openai/text-embedding-3-small`: 1536 dimensions natively, so it shares the existing `text-embedding-3-small@1536` space and Atlas index with OpenAI users (no reindex when switching between the two). Costs about $0.02 per million tokens; a key without credit falls back to keyword search.
- **Store the provider with each AI config** instead of guessing it from the model name (OpenRouter ids look like `openai/gpt-4o`). Existing configs fall back to the name-based guess.
- Later, optionally: a free embedding model (e.g. `nvidia/nemotron-3-embed-1b:free`). Needs a second vector index for its dimensions, and free models may retain requests for training, so it must be an explicit opt-in with a warning.

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
- [ ] Usage dashboard (tokens, model usage)
