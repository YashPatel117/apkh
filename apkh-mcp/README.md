# apkh-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude Code, Claude Desktop, Cursor and other MCP clients) access to your Knowledge Hub. Ask *"search my notes for the Q3 budget"* and the assistant calls `search_notes`, reads the passages, and answers from your own notes.

It runs locally over stdio and only talks to `apkh-api`, authenticated with an integration token. It never connects to the database or the other services.

## Tools

| Tool | What it does |
|---|---|
| `search_notes` | Hybrid search (by meaning and by keyword) over your notes and attachment text. Returns ranked passages with their `note_id`, file name and page. Options: `limit` (1–20, default 8), `note_ids` (search only inside these notes). |
| `get_note` | One note in full, as Markdown, with its category, folder and attachment names. Notes over 40,000 characters are cut. |
| `create_note` | Saves a new note (Markdown). A missing title or category is filled in, and the note is indexed in the background like any other. |

Search returns passages, not an AI answer. The assistant is already a model, so it reads the passages itself. Only the query embedding runs on your active AI provider. With Claude as your provider, or no AI at all, search uses keywords only.

## Set up

**1. Build** (`setup-all.bat` already does this):

```bash
cd apkh-mcp
npm install
npm run build
```

**2. Create a token** that can read notes, using either:

- the app: **Profile → Integrations → API tokens**, with **Can read and search notes** ticked, or
- the CLI, from `apkh-api/`: `npm run token:create -- you@example.com "Claude Code" --read`

The token (`apkh_…`) is shown once. Revoke it in Profile at any time.

**3. Register it with Claude Code:**

```bash
claude mcp add apkh --scope user \
  --env APKH_API_URL=http://localhost:3000 \
  --env APKH_TOKEN=apkh_xxxxxxxx \
  -- node "D:/Learn Projects/AI-Powered-Personal-Knowledge-Hub/apkh-mcp/dist/index.js"
```

Use the absolute path to `dist/index.js` on your machine. Then check it:

```bash
claude mcp list        # apkh: … ✔ Connected
```

In a Claude Code session, `/mcp` lists its tools. Try *"search my notes for …"*, *"open that note"* or *"save this as a note in AI Insights"*.

**Other clients** (Claude Desktop, Cursor…) take the same command, args and env in their MCP config:

```json
{
  "mcpServers": {
    "apkh": {
      "command": "node",
      "args": ["D:/Learn Projects/AI-Powered-Personal-Knowledge-Hub/apkh-mcp/dist/index.js"],
      "env": { "APKH_API_URL": "http://localhost:3000", "APKH_TOKEN": "apkh_xxxxxxxx" }
    }
  }
}
```

## Configuration

| Variable | Default | |
|---|---|---|
| `APKH_API_URL` | `http://localhost:3000` | Where `apkh-api` runs |
| `APKH_TOKEN` | none | An integration token with read access. Without one, every tool says how to create it. |
| `APKH_TIMEOUT_MS` | `30000` | Per request. Raise it (e.g. `120000`) if the built-in AI on a CPU is slow to embed queries. |

Keep the token in your user-level config (`--scope user`), not in a committed `.mcp.json`. A shared `.mcp.json` can reference it as `"APKH_TOKEN": "${APKH_TOKEN}"`.

## Testing

```bash
APKH_TOKEN=apkh_… npm run smoke -- "your query"            # list tools, search, get_note over real MCP
APKH_TOKEN=apkh_… npm run smoke -- "your query" --create   # also saves a test note
npm run inspect                                             # the MCP Inspector UI (set APKH_TOKEN first)
```

## Security

- A token sees only its owner's notes. Read and write are separate scopes, and tokens made before scopes existed stay write-only, so a clipper or Zapier token can't read notes.
- At most 60 requests a minute per token.
- There is no delete or edit tool, and Claude Code asks before running `create_note`.
- Note text is untrusted. A clipped web page or an email can contain text that reads like instructions. Results are wrapped in `<passage>` / `<note>` tags and labelled as data, but review what an assistant does after reading notes from untrusted sources.

The API side (`/integrations/mcp/*`, token scopes) and the plan for GitHub and Jira tools are in [MCP_PLAN.md](../MCP_PLAN.md).
