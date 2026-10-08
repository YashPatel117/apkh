# MCP Server Plan

A small TypeScript server, `apkh-mcp`, built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk). It exposes the Knowledge Hub as tools that any MCP client (Claude Code, Claude Desktop, Cursor…) can call. You can then ask Claude Code *"search my notes for the Q3 budget"* and it calls `search_notes`, reads the passages, and answers from your own notes.

The same pattern later covers the GitHub and Jira integrations (`list_issues`, `get_issue`, `save_issue_as_note`).

## 1. Goals

- **v1:** three tools (`search_notes`, `get_note`, `create_note`) over stdio, registered with `claude mcp add`, working against a local `apkh-api`.
- **No new trust model:** authenticate with the existing **integration tokens** (`apkh_…`, Profile → Integrations), not the user's login JWT.
- **Thin server:** `apkh-mcp` only calls `apkh-api` over HTTP. It never touches MongoDB, `apkh-search` or `apkh-storage` directly, so all user scoping, plan limits and token tracking stay in the API.
- **Later:** GitHub / Jira tools, then a remote (Streamable HTTP) transport hosted by the API.

**Not in scope for v1:** deleting or editing notes, attachments, chat, and any OAuth flow.

## 2. How it fits

```text
 Claude Code ──stdio──► apkh-mcp (node, local process)
                          │  Authorization: Bearer apkh_…
                          ▼
                       apkh-api  /integrations/mcp/*   (new)
                          │  userForToken() → userId
                          │  ServiceTokenService.forUser(userId) → short-lived JWT
                          ├──► RetrievalService (hybrid search)   ──► apkh-search /ingest/embed (query vector)
                          └──► NotesService (find / create)
```

Claude Code starts `apkh-mcp` as a child process and talks JSON-RPC over stdin/stdout. Each tool call becomes one HTTP request to `apkh-api`.

## 3. The auth gap (API work needed first)

Today the two kinds of credential don't overlap:

| Route | Accepts |
|---|---|
| `/notes/*` (search, read, create…) | the login JWT only (`AuthGuard`) |
| `POST /integrations/notes` | an `apkh_` integration token only (`userForToken`) |

So an integration token can **create** a note but not **search** or **read** one. Options:

| Option | Verdict |
|---|---|
| **A. New `/integrations/mcp/*` routes that accept `apkh_` tokens** | **Recommended.** Small, explicit surface; reuses `userForToken`; leaves `AuthGuard` untouched. |
| B. Let `AuthGuard` also accept `apkh_` tokens | Opens every `/notes`, `/users`, `/admin` route to tokens. Too broad. |
| C. Paste the login JWT into the MCP config | Expires, can't be revoked per client, and grants the whole account. |

**Token scopes.** Existing tokens (clipper, Zapier, webhooks) can only add notes. If they suddenly gained read access, a leaked clipper token would expose every note. So add scopes to `IntegrationToken`:

- `scopes: ('notes:write' | 'notes:read')[]`, default `['notes:write']`, so **existing tokens keep exactly what they have** (no migration needed if the default is applied on read).
- `createToken(userId, name, scopes)`; Profile → Integrations gets a **"Can read and search notes (for AI assistants / MCP)"** checkbox, off by default.
- `userForToken(secret, requiredScope)` checks the scope and returns 403 when it's missing.

**Calling `apkh-search` without a user JWT.** Search needs a query embedding, and `apkh-search` verifies a JWT. The MCP routes sign one with `ServiceTokenService.forUser(userId)`, as the indexing worker already does. That service lives in `indexing/` today; export it from `IndexingModule` (or move it to `common/`) so `IntegrationsModule` can use it.

## 4. API endpoints to add (`apkh-api`)

All under `IntegrationsController`, authenticated with `Authorization: Bearer apkh_…` or `X-API-Key`.

| Endpoint | Scope | Does |
|---|---|---|
| `POST /integrations/mcp/search` | `notes:read` | `{ query, limit?, noteIds? }` → ranked passages (no AI answer) |
| `GET /integrations/mcp/notes/:id` | `notes:read` | one note as Markdown, plus title, category, folder, dates, attachment names |
| `GET /integrations/mcp/notes` | `notes:read` | (v1.1) list notes: `q`, `category`, `folderId`, `limit`, `cursor` (reuses `findPage`) |
| `POST /integrations/notes` | `notes:write` | **already exists**; `format: 'markdown'` is supported |

**Search returns passages, not an answer.** The MCP client is already an LLM; sending it a RAG answer would double the cost and add a second model's paraphrase. So `/mcp/search` runs only the retrieval half of AI search. Factor it out of `SearchService.planAiSearch` into a new method:

```ts
// search.service.ts
async searchPassages(token: string, userId: string, query: string,
                     opts: { limit: number; noteIds?: string[] }): Promise<RetrievedChunk[]>
```

It does: active LLM config → embed the query (skip for Claude / no credit, as today) → `retrieval.retrieve(...)` with `sourceTypes: ['note', 'file']` → weak-result query rewrite (optional in v1). `planAiSearch` then calls it, so the web app and MCP share one code path.

- Query embedding tokens are tracked with `addTokenUsage` as non-interactive (like indexing), so MCP searches don't burn the built-in AI's session allowance. Revisit if it's abused.
- With no active AI config and the built-in AI off, return keyword-only results instead of an error.

**Note as Markdown.** `notes/utils/markdown.ts` already has `noteToMarkdown()` (Turndown, Quill lists, file tokens) for export; reuse it. Cap the body at ~40,000 characters and say so in the response when it was cut (`truncated: true`), so a huge note can't flood the client's context.

## 5. Tools (`apkh-mcp`)

| Tool | Input | Output | Annotations |
|---|---|---|---|
| `search_notes` | `query: string` (required), `limit?: 1–20` (default 8), `note_ids?: string[]` | Ranked passages: note id, note title, source (`note` or file name + page), match (`meaning` / `keyword` / `both`), text | `readOnlyHint: true` |
| `get_note` | `id: string` | Title, category, folder, updated date, attachment names, Markdown body | `readOnlyHint: true` |
| `create_note` | `title?: string`, `content: string` (Markdown), `category?: string`, `url?: string` | `{ id, title }` + a link to the note in the web app | `readOnlyHint: false`, `destructiveHint: false` |

**Descriptions matter more than code.** The model picks tools from their descriptions, so they say *when* to use the tool:

- `search_notes`: "Search the user's personal Knowledge Hub notes and attachments (hybrid keyword + semantic). Use it when the user asks about their notes, past decisions, meeting notes or saved documents. Returns passages; call `get_note` for a full note."
- `get_note`: "Fetch one note in full by the id returned from `search_notes`."
- `create_note`: "Save a new note to the user's Knowledge Hub. Only when the user asks to save or remember something. Content is Markdown."

**Output format.** Return one `text` content block formatted for reading (the model reads it), and `structuredContent` with an `outputSchema` for clients that use it:

```text
Found 3 passages for "Q3 budget":

[1] Q3 planning (note 66f1…a2) · q3.pdf p.2 · meaning+keyword
    Marketing budget is capped at $40k for Q3, approved by Priya on 12 Aug…

[2] Weekly sync 2026-08-19 (note 66f3…9c) · note text · keyword
    …
```

**Errors** come back as `isError: true` with the API's one-line message (e.g. "This token can't read notes. Create one with read access in Profile → Integrations."), never as a thrown exception, so the model can explain it to the user.

### Later tools (v1.1+)

| Tool | Backed by |
|---|---|
| `list_notes` (by folder / category / recent) | `GET /integrations/mcp/notes` |
| `list_folders` | `FoldersService` |
| `similar_notes` | `GET /notes/:id/similar` logic |
| `summarize_note` (`brief` / `actions`) | `NotesService.summarize`; returns tasks, decisions, deadlines |
| `append_to_note` | new endpoint; keeps a version (version history already exists) |
| Resource template `apkh://note/{id}` | same as `get_note`, so clients can `@`-attach a note |

## 6. Package layout

New top-level package, next to the other services:

```text
apkh-mcp/
  package.json         "type": "module", "bin": { "apkh-mcp": "dist/index.js" }
  tsconfig.json        target ES2022, module NodeNext
  .env.example         APKH_API_URL, APKH_TOKEN, APKH_WEB_URL
  src/
    index.ts           server setup + stdio transport
    client.ts          fetch wrapper: base URL, auth header, timeout, error → message
    format.ts          passages / note → readable text
    tools/
      notes.ts         search_notes, get_note, create_note
      github.ts        (phase 3)
      jira.ts          (phase 3)
```

Dependencies: `@modelcontextprotocol/sdk`, `zod`. Dev: `typescript`, `@types/node`. Node 20's built-in `fetch` is enough, no axios.

Sketch of `index.ts`:

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { api } from './client.js';
import { formatPassages } from './format.js';

const server = new McpServer({ name: 'apkh', version: '0.1.0' });

server.registerTool(
  'search_notes',
  {
    title: 'Search notes',
    description: 'Search the user\'s Knowledge Hub notes and attachments…',
    inputSchema: {
      query: z.string().min(1).max(4000),
      limit: z.number().int().min(1).max(20).optional(),
      note_ids: z.array(z.string()).max(50).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query, limit, note_ids }) => {
    const res = await api.post('/integrations/mcp/search', { query, limit, noteIds: note_ids });
    if (!res.ok) return { isError: true, content: [{ type: 'text', text: res.error }] };
    return { content: [{ type: 'text', text: formatPassages(query, res.data) }] };
  },
);

// get_note, create_note …

await server.connect(new StdioServerTransport());
console.error('apkh-mcp ready'); // stderr: stdout is the protocol channel
```

**stdio rule:** never write to stdout (`console.log`) in the server; it corrupts the JSON-RPC stream. Log with `console.error`.

## 7. Registering with Claude Code

Build once (`cd apkh-mcp && npm install && npm run build`), create a token with read access in Profile → Integrations, then:

```bash
claude mcp add apkh --scope user \
  --env APKH_API_URL=http://localhost:3000 \
  --env APKH_TOKEN=apkh_xxxxxxxx \
  -- node "D:/Learn Projects/AI-Powered-Personal-Knowledge-Hub/apkh-mcp/dist/index.js"
```

- `claude mcp list` shows it as connected; `/mcp` inside a session shows its tools.
- `--scope user` keeps the token out of the repo. For a shared project config (`.mcp.json`, scope `project`), commit it with `"APKH_TOKEN": "${APKH_TOKEN}"` and let each developer set the variable; never commit a real token.
- On Windows, launching through `npx` needs `cmd /c npx …`; calling `node` directly, as above, doesn't.
- Claude Code warns when a tool returns more than about 10,000 tokens, which is one more reason for the `limit` and truncation caps above.

**Demo script:** "search my notes for X" → `search_notes`; "open the second one" → `get_note`; "save a summary of this conversation as a note in AI Insights" → `create_note`, then see it appear (and get indexed) in the web app.

## 8. GitHub and Jira (same pattern)

Each integration is one more file in `src/tools/`, enabled only when its env vars are set, so the notes tools keep working without them.

| Tool | Calls | Env |
|---|---|---|
| `list_issues` (`repo`, `state`, `labels`, `assignee`, `limit`) | GitHub REST `GET /repos/{owner}/{repo}/issues` (drop pull requests, which that endpoint also returns) | `GITHUB_TOKEN` (fine-grained, Issues: read), `GITHUB_DEFAULT_REPO` |
| `get_issue` (`repo`, `number`) | issue + first N comments | same |
| `search_jira` (`jql`, `limit`) | Jira Cloud `GET /rest/api/3/search/jql` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| `get_jira_issue` (`key`) | `GET /rest/api/3/issue/{key}` (description is ADF; flatten to text) | same |
| `save_issue_as_note` (`source`, `id`) | fetch the issue → `POST /integrations/notes` with `category: "GitHub"` / `"Jira"` and `url` set | both |

Official GitHub and Atlassian MCP servers already exist and do more. Building these is worth it for the **cross-system** part: one prompt such as *"find my notes about the login bug and link them in a comment on issue #42"* uses `search_notes` + `get_issue` together, and `save_issue_as_note` makes issues searchable in the Hub's hybrid search. Run the official servers alongside if you need more GitHub or Jira operations.

## 9. Security

- **Per-user by construction:** the API resolves the token to one `userId`, and every query is scoped to it; the MCP process holds no other credential.
- **Least privilege:** read and write scopes are separate; v1 has no delete or overwrite tool. Revoking the token in Profile cuts the client off at once (`lastUsedAt` shows when it was last used).
- **Prompt injection:** note content is untrusted. Notes clipped from web pages or received by email can contain text like "ignore previous instructions…", and the passages go straight into the model's context. Mitigations: write tools need explicit user intent (in the descriptions), Claude Code asks for permission before write tools by default, and passages are clearly framed as quoted note content in the output.
- **Size limits:** search `limit` ≤ 20, passages as stored (≤ 512 tokens each), note bodies cut at ~40k characters.
- **Rate limit** the `/integrations/mcp/*` routes per token (e.g. 60 requests/minute) so a looping agent can't hammer the embedding provider.
- The token lives only in the MCP client's config (user scope), never in the repo.

## 10. Testing

- **API:** unit tests for scope checks (a write-only token gets 403 on `/mcp/search`, a revoked token 401, another user's note id 404) and for `searchPassages` matching what AI search retrieves for the same query.
- **Server:** run it in the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector node dist/index.js`), call each tool, and check errors come back as `isError` results.
- **End to end:** the demo script in section 7, against a user with an own key, a Claude key (keyword only) and the built-in AI.

## 11. Milestones

**Phase 1: API groundwork** ✅
- [x] `scopes` on `IntegrationToken` (unset = `['notes:write']`), scope check in `userForToken`
- [x] Scope checkbox and a "read + write" badge in Profile → Integrations (`apkh-web`, en / es / hi)
- [x] Export `ServiceTokenService` for `IntegrationsModule`
- [x] `SearchService.searchPassages`; it and `planAiSearch` share `embedSearchQuery` and `retrieveNotePassages`
- [x] `POST /integrations/mcp/search`, `GET /integrations/mcp/notes/:id` (`NotesService.noteMarkdown`, shared with export)
- [x] Rate limit: 60 requests a minute per token, on every token route (in memory, per API process)
- [x] `npm run token:create -- <email> <name> [--read]` / `-- --revoke <id>` in `apkh-api/`

**Phase 2: `apkh-mcp` v1** ✅
- [x] Package scaffold, `client.ts`, `format.ts`
- [x] `search_notes`, `get_note`, `create_note`
- [x] `apkh-mcp/README.md`, README section, `.env.example`; `setup-all.bat` installs and builds it
- [x] `npm run smoke` (a real MCP client over stdio) and a Claude Code end-to-end check

**As built, differences from the plan above:** search skips the query rewrite and the built-in AI allowance (the assistant can rephrase, and only the query embedding runs); tools return text only, without `outputSchema` / `structuredContent`; results carry no web-app link, since the app has no per-note URL yet; the rate limit also covers `POST /integrations/notes`.

**Phase 3: more tools**
- [ ] `list_notes`, `list_folders`, `summarize_note`, `similar_notes`
- [ ] GitHub: `list_issues`, `get_issue`; Jira: `search_jira`, `get_jira_issue`
- [ ] `save_issue_as_note`

**Phase 4: remote**
- [ ] Streamable HTTP transport served by `apkh-api` (e.g. `/mcp`), so clients connect by URL with no local process
- [ ] OAuth 2.1 sign-in for remote clients instead of pasting a token

## 12. Open questions

- Should MCP query embeddings on the built-in AI count against the Free plan's session allowance? (Proposed: no, track them only.)
- Should `create_note` default to the **AI Insights** category, like "Save as note" in the web app?
- Publish `apkh-mcp` to npm (`npx apkh-mcp`), or keep it in the repo only?
