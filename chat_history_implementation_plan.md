# Chat History Feature — Implementation Plan

Add a full-featured chat history system to the APKH RAG app: new MongoDB schemas, NestJS API endpoints, FastAPI chat-aware RAG endpoint, auto-chunking logic, updated system prompt, and a complete frontend chat UI with sidebar + "Continue this conversation" flow.

## User Review Required

> [!IMPORTANT]
> **Architecture Decision: Where does the chat RAG endpoint live?**  
> The spec says `POST /chat/session/{session_id}/message` should assemble priority-ordered context and call `apkh-search`. Currently, the NestJS API (`apkh-api`) orchestrates RAG calls by calling the FastAPI service (`apkh-search`). This plan follows the same pattern: all chat session CRUD + orchestration logic lives in `apkh-api`, and a **new** FastAPI endpoint (`/ai-search/chat-rag`) handles the multi-source prompt construction + LLM invocation.

> [!WARNING]
> **Breaking change to `knowledge_chunks` schema**: The `sourceType` enum will be expanded from `['note', 'file']` to `['note', 'file', 'chat']`. A new optional field `sourceId` (string) is added. Existing data is unaffected since all current chunks have `sourceType: 'note' | 'file'`.

---

## Proposed Changes

### Database Layer (apkh-api)

#### [NEW] [chat-session.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/common/schema/chat-session.ts)
New Mongoose schema for chat sessions:
- `userId` (ObjectId, ref User, required, indexed)
- `title` (string, required) — auto-generated from first user message (first 6 words + "...")
- `isChunked` (boolean, default false) — tracks whether this session has been chunked into knowledge_chunks
- `timestamps: true` → auto `createdAt`, `updatedAt`

#### [NEW] [chat-message.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/common/schema/chat-message.ts)
New Mongoose schema for chat messages:
- `sessionId` (ObjectId, ref ChatSession, required, indexed)
- `role` (string, enum `['user', 'assistant']`, required)
- `content` (string, required)
- `timestamps: true` → auto `createdAt`

#### [MODIFY] [chunk.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/common/schema/chunk.ts)
- Expand `sourceType` enum: `['note', 'file']` → `['note', 'file', 'chat']`
- Add optional `sourceId` prop (string) — stores the chat session ID when `sourceType === 'chat'`
- Add compound index: `{ userId: 1, sourceType: 1, sourceId: 1 }`

---

### Backend — Chat Module (apkh-api)

#### [NEW] [chat.module.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/chat/chat.module.ts)
NestJS module importing:
- `MongooseModule.forFeature` for `ChatSession`, `ChatMessage`, `KnowledgeChunk`
- `HttpModule`, `UsersModule`, `SearchModule`

#### [NEW] [chat.controller.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/chat/chat.controller.ts)
Protected by `AuthGuard`. Endpoints:

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/chat/session` | Create new session (body: `{ firstMessage, aiResponse }`) |
| `GET` | `/chat/sessions` | List all sessions for user (id, title, updatedAt) |
| `GET` | `/chat/session/:id` | Get all messages of a session |
| `DELETE` | `/chat/session/:id` | Delete session + its messages + its chunks |
| `POST` | `/chat/session/:id/message` | Send message, get AI response |

#### [NEW] [chat.service.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/chat/chat.service.ts)
Core logic:

1. **`createSession(userId, firstMessage, aiResponse)`**
   - Create `ChatSession` with title = first 6 words of `firstMessage` + "..."
   - Insert 2 `ChatMessage` docs (user + assistant)
   - Return session object

2. **`listSessions(userId)`**
   - Find all sessions for user, sorted by `updatedAt` desc
   - Return `[{ id, title, updatedAt, messageCount }]`

3. **`getSessionMessages(userId, sessionId)`**
   - Verify session belongs to user
   - Return all messages sorted by `createdAt` asc

4. **`deleteSession(userId, sessionId)`**
   - Delete session, all its messages, and any chunks with `sourceType: 'chat'` + `sourceId: sessionId`

5. **`sendMessage(token, userId, sessionId, userMessage)`**
   - Save user message to DB
   - Assemble context in priority order:
     - **Priority 1**: chunks where `sourceType='chat'` AND `sourceId=sessionId`
     - **Priority 2**: chunks where `sourceType='note'` (user-scoped)
     - **Priority 3**: chunks where `sourceType='chat'` AND `sourceId != sessionId`, ranked by embedding similarity
   - Also include the **last N messages** (up to 10) from the current session as direct conversational context
   - Call the new FastAPI `/ai-search/chat-rag` endpoint
   - Save assistant response to DB
   - Update session `updatedAt`
   - Check auto-chunking threshold (10+ messages)
   - Return AI answer

6. **`autoChunkSession(token, userId, sessionId)`**
   - Triggered when message count ≥ 10 and `isChunked === false`
   - Concatenate all messages as `"User: ...\nAssistant: ..."` text
   - Call existing `/ingest`-style chunking + embedding (reuse `SearchService` or direct HTTP)
   - Store resulting chunks with `sourceType: 'chat'`, `sourceId: sessionId`
   - Set `isChunked = true` on the session

#### [NEW] [dto/create-session.dto.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/chat/dto/create-session.dto.ts)
```ts
export class CreateSessionDto {
  firstMessage: string;
  aiResponse: string;
}
```

#### [NEW] [dto/send-message.dto.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/chat/dto/send-message.dto.ts)
```ts
export class SendMessageDto {
  message: string;
}
```

#### [MODIFY] [app.module.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-api/src/app.module.ts)
- Import `ChatModule` in the `imports` array

---

### Backend — New FastAPI Chat RAG Endpoint (apkh-search)

#### [NEW] [chat_rag.py](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/routes/chat_rag.py)
New router `prefix="/ai-search"`. Endpoint:

**`POST /ai-search/chat-rag`**

Request body:
```python
class ChatRagRequest(BaseModel):
    query: str
    chat_history: list[dict]      # [{role, content}] — last N messages
    current_chat_chunks: list[str] # Priority 1 context
    notes_chunks: list[str]        # Priority 2 context
    similar_chat_chunks: list[str] # Priority 3 context
    api_key: str
    model: str
```

This endpoint:
1. Builds the multi-source system prompt (see §Updated System Prompt below)
2. Includes chat history as conversation context
3. Calls the appropriate LLM provider (reuses `_call_gemini`/`_call_openai`/`_call_anthropic`)
4. Returns `{ answer, tokens_used, run_id }`
5. Uses LangSmith tracing

#### [MODIFY] [main.py](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/main.py)
- Import and register the new `chat_rag` router

#### [MODIFY] [llm.py](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-search/services/llm.py)
- Add new `_CHAT_SYSTEM_INSTRUCTION` constant with the multi-source prompt template
- Add `generate_chat_rag_answer()` function that:
  - Accepts `query`, `chat_history`, `current_chat_chunks`, `notes_chunks`, `similar_chat_chunks`, `api_key`, `model`, etc.
  - Formats the multi-source system prompt
  - Sends conversation as alternating Human/AI messages for providers that support it
  - Returns `{ answer, tokens_used, run_id }`

---

### Updated System Prompt

```
You are a helpful AI assistant with access to the user's personal knowledge base.

You are given context from three sources in order of priority:

[CURRENT CHAT CONTEXT]
{current_chat_chunks}
This is from the ongoing conversation. Treat this as the most relevant context.

[NOTES CONTEXT]
{notes_chunks}
This is from the user's saved notes and documents.

[RELATED PAST CHATS]
{similar_chat_chunks}
These are from previous conversations on similar topics. Use as supporting context only.

Instructions:
- Prioritize CURRENT CHAT CONTEXT over everything else for follow-up questions
- Use NOTES CONTEXT as your primary knowledge source
- Reference RELATED PAST CHATS only when current context is insufficient
- If the user asks a follow-up question, resolve pronouns and references using CURRENT CHAT CONTEXT first
- Always be concise. If unsure, say so.
- Never fabricate information not present in the context above.
```

---

### Frontend

#### [NEW] [chatService.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/service/chatService.ts)
API client functions:
- `createChatSession(firstMessage, aiResponse)` → POST `/chat/session`
- `getChatSessions()` → GET `/chat/sessions`
- `getChatMessages(sessionId)` → GET `/chat/session/:id`
- `deleteChatSession(sessionId)` → DELETE `/chat/session/:id`
- `sendChatMessage(sessionId, message)` → POST `/chat/session/:id/message`

Types:
```ts
export interface IChatSession { id: string; title: string; updatedAt: string; messageCount: number; }
export interface IChatMessage { id: string; sessionId: string; role: 'user' | 'assistant'; content: string; createdAt: string; }
export interface ChatMessageResponse { answer: string; tokens_used: number; }
```

#### [NEW] [chatSlice.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/store/slices/chatSlice.ts)
Redux slice for chat state:
- `sessions: IChatSession[]`
- `activeSessionId: string | null`
- `messages: IChatMessage[]`
- `isLoading: boolean`
- Actions: `setSessions`, `addSession`, `removeSession`, `setActiveSession`, `setMessages`, `addMessage`, `setLoading`

#### [MODIFY] [store.ts](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/store/store.ts)
- Add `chat: chatReducer` to the store

#### [NEW] [chat/page.tsx](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/app/(home)/chat/page.tsx)
**Chat History Page** — full conversation UI:
- Left sidebar: list of all chat sessions (title + date), "New Chat" button, delete button per session, active session highlighted
- Main area: full conversation with message bubbles (user right, assistant left)
- Input bar at bottom with send button
- Typing indicator while waiting for response
- Auto-scroll to latest message
- Session title shown at top
- Responsive layout

#### [NEW] [chat/layout.tsx](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/app/(home)/chat/layout.tsx)
Layout that fetches chat sessions on mount. Sets up the chat context.

#### [MODIFY] [layout.tsx](file:///d:/Learn%20Projects/AI-Powered-Personal-Knowledge-Hub/apkh-web/src/app/(home)/layout.tsx)
After the AI answer panel (when response is shown and not an error):
- Add a **"Continue this conversation →"** button below the AI response
- On click:
  - Calls `createChatSession(query, answer)`
  - Redirects to `/chat?session={newSessionId}`

Also add a **"Chat History"** link in the nav/profile dropdown menu.

---

### Auto-Chunking Logic

Triggered in `chat.service.ts` → `sendMessage()`:
1. After saving the assistant response, count total messages in the session
2. If `count >= 10` AND `session.isChunked === false`:
   - Fire-and-forget call to `autoChunkSession()`
3. `autoChunkSession()`:
   - Fetch all messages, concatenate as `"User: ...\nAssistant: ..."` blocks
   - Build a "chat document" text
   - Call the chunker + embedder (via the existing `SearchService.processIngestion()` pattern or direct HTTP to `apkh-search/ingest`)
   - Store chunks with `sourceType: 'chat'`, `sourceId: sessionId`, `noteTitle: session.title`
   - Mark `session.isChunked = true`

---

## Open Questions

> [!IMPORTANT]
> 1. **Re-chunking on subsequent messages**: Once a session is chunked at 10 messages, should new messages trigger a re-chunk? Current plan: chunk once at 10, then re-chunk every additional 10 messages (at 20, 30, etc.). Is this acceptable, or should it only chunk once?

> [!IMPORTANT]
> 2. **Chat session limit**: Should there be a maximum number of chat sessions per user? The current plan has no limit.

> [!NOTE]
> 3. **Existing feature impact**: The `knowledge_chunks` schema change (adding `'chat'` to `sourceType` enum and the optional `sourceId` field) is backward-compatible. All existing features (notes, documents, AI search, summaries) will continue to work unchanged since they already filter by `sourceType: 'note' | 'file'`.

---

## Verification Plan

### Automated Tests
1. Start all services (`apkh-api`, `apkh-search`, `apkh-web`)
2. Create a new chat session via the "Continue this conversation" button on the home page
3. Verify the session appears in the chat sidebar
4. Send follow-up messages and verify AI responses use the correct multi-source context
5. Verify session deletion removes messages and associated chunks
6. Verify auto-chunking triggers after 10 messages

### Manual Verification
1. Full end-to-end flow: AI search → "Continue this conversation" → chat page → follow-up questions
2. Verify chat sidebar updates in real-time
3. Verify typing indicator and auto-scroll behavior
4. Verify existing notes/AI search features are unaffected
5. Check LangSmith traces for chat-rag calls
