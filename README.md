# AI-Powered Personal Knowledge Hub

A note-taking app with an AI layer: write rich notes with attachments, then ask questions and get answers grounded in your own notes, with numbered citations that jump to the exact passage or file page. It works without any AI key: a **built-in AI** (open-source models the server runs itself through Ollama) serves every user, within their plan: **Free** or **Pro**, which set a token allowance per session and a place in the queue. On either plan, users can add their own key (OpenRouter, Gemini, OpenAI or Claude) for faster, stronger models with no limit; OpenRouter's free models also cost nothing.

| Service | Stack | Port | Role |
|---|---|---|---|
| `apkh-web` | Next.js 15, React 19 | 3002 | The web app |
| `apkh-api` | NestJS 11, MongoDB | 3000 | Notes, chats, auth, search index, background indexing |
| `apkh-storage` | Express | 3001 | Attachment files |
| `apkh-search` | FastAPI, LangChain | 8000 | Reads files, chunks, embeds, generates answers (stateless) |

How it all fits together: [ARCHITECTURE.md](ARCHITECTURE.md). Roadmap: [PLANS.md](PLANS.md).

## Prerequisites

- **Node.js 20+** (includes npm)
- **Python 3.11+**
- **MongoDB**: a [MongoDB Atlas](https://www.mongodb.com/atlas) cluster is recommended (the free tier works) because it adds database-side vector search. A local MongoDB also works; similarity is then computed in the API.
- **[Ollama](https://ollama.com/download)**, for the free built-in AI (`winget install Ollama.Ollama`). It needs about 6 GB of RAM and 4 GB of disk for its two models. Without Ollama, users need their own AI key.
- **Windows Terminal** (optional): `start-all.bat` opens one tab per service with it, or separate windows without it.
- **AI API keys** are optional: users add their own (OpenRouter, Google AI Studio, OpenAI or Anthropic) in the app, not in a file.

## Quick start (Windows)

Run everything from the repository root.

**1. Install**

```bat
setup-all.bat
```

In PowerShell type `.\setup-all.bat`; you can also double-click the file in Explorer. It is safe to run again at any time. It:

1. checks that Node.js, npm and Python are installed
2. creates any missing env file from its `.env.example` (`apkh-api/.env`, `apkh-storage/.env`, `apkh-search/.env`, `apkh-web/.env.local`), generating one shared `JWT_SECRET` and an `ENCRYPTION_SECRET`. Existing files are never overwritten.
3. runs `npm install` in `apkh-api`, `apkh-storage` and `apkh-web`
4. creates `apkh-search/.venv` and installs `requirements.txt`
5. if Ollama is installed, downloads the built-in AI models (`qwen3.5:4b`, `qwen3-embedding:0.6b`, about 4 GB) and sets `OLLAMA_CONTEXT_LENGTH=8192` for your Windows user, so long notes fit (restart Ollama once afterwards). Without Ollama this step only prints how to add it.

**2. Point the API at your database**

Set `MONGODB_URI` in `apkh-api/.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/apkh?retryWrites=true&w=majority
```

**3. Create the vector search index (Atlas only, once)**

```bat
cd apkh-api
npm run search:vector-index
```

Atlas builds it in the background; in the Atlas UI (cluster > Atlas Search) wait for `chunk_vectors` to show **READY**. Skip this step on a local MongoDB and set `ATLAS_VECTOR_INDEX=off` in `apkh-api/.env`.

**4. Start**

```bat
start-all.bat
```

(`.\start-all.bat` in PowerShell.) It refuses to start if setup hasn't run, starts Ollama if it is installed but not running, then starts the four services and prints their URLs.

**5. Use it**

Open http://localhost:3002 and register. New accounts are on the Free plan with the **Built-in AI** active straight away, and your notes are indexed in the background. **Profile** shows this session's usage and the plans. To use your own key instead, go to **Profile > AI models > Add key**: pick the provider, pick a model from the live list, **Test connection**, then **Save & activate**. You can switch back to the Built-in AI there at any time.

To give someone Pro, create a one-time code (from `apkh-api/`): `npm run vouchers:create -- 1`. They redeem it in **Profile > Plan > Upgrade**. `npm run vouchers:create -- --list` shows every code and whether it was used. Or set a plan directly: `npm run plan:set -- user@example.com pro` (without a plan it shows their current one).

## Configuration

Each service reads its own env file; the `.env.example` next to it documents every variable.

| File | Variable | Default | Notes |
|---|---|---|---|
| `apkh-api/.env` | `MONGODB_URI` | — | Required |
| | `JWT_SECRET` | — | Required; **identical** in api, storage and search |
| | `ENCRYPTION_SECRET` | — | Required; encrypts users' AI keys at rest |
| | `CORS_ORIGINS` | `http://localhost:3002` | Comma-separated browser origins |
| | `STORAGE_API_URL`, `SEARCH_API_URL` | `http://localhost:3001/`, `http://localhost:8000` | |
| | `ATLAS_VECTOR_INDEX` | `chunk_vectors` | `off` on a non-Atlas MongoDB |
| | `INDEX_WORKER`, `RUN_MIGRATIONS` | on | `off` to disable on an instance |
| | `BUILTIN_AI` | on | `off` hides the built-in AI (users then need their own key) |
| | `PLAN_SESSION_HOURS` | `5` | Length of a usage session |
| | `PLAN_FREE_SESSION_TOKENS`, `PLAN_PRO_SESSION_TOKENS` | `30000`, `200000` | Built-in AI tokens per session on each plan |
| `apkh-storage/.env` | `JWT_SECRET`, `CORS_ORIGINS`, `PORT` | | |
| `apkh-search/.env` | `JWT_SECRET`, `CORS_ORIGINS`, `STORAGE_API_URL` | | |
| | `BUILTIN_AI_BASE_URL` | `http://localhost:11434/v1` | Ollama, or any OpenAI-compatible server |
| | `BUILTIN_AI_CHAT_MODEL` | `qwen3.5:4b` | `qwen3.5:2b` is about twice as fast |
| | `BUILTIN_AI_EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | That server's name for Qwen3-Embedding-0.6B; don't change the model |
| | `BUILTIN_AI_VISION`, `BUILTIN_AI_API_KEY` | on, none | `off` for a chat model that can't read images; a key only if the server needs one |
| | `BUILTIN_AI_CHAT_SLOTS`, `BUILTIN_AI_EMBEDDING_SLOTS` | `1`, `1` | Calls run at once per model; the rest queue by plan. Raise only with a GPU |
| | `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` | tracing off | Optional LangSmith tracing |
| `apkh-web/.env.local` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL` | localhost | Use your LAN IP to open the app from other devices |

To open the app from a phone or another computer, put your machine's LAN IP in `apkh-web/.env.local` and add `http://<lan-ip>:3002` to `CORS_ORIGINS` in the API and storage env files.

## Built-in AI and plans

Users without a key of their own share open-source models that run on your server: **Qwen3.5 4B** for answers, summaries and reading images, and **Qwen3-Embedding-0.6B** for search by meaning. Nobody pays the model provider; each user's plan sets how much they get.

| | Free | Pro |
|---|---|---|
| Built-in AI per session | 30,000 tokens (about 15 questions) | 200,000 tokens |
| Queue | after Pro | first |
| Own AI keys | unlimited | unlimited |

- **Sessions.** A session opens with the user's first question and lasts 5 hours; then the allowance starts over. Questions, chat replies, summaries and query rewrites count. Indexing notes (embeddings, reading images) doesn't count and is never blocked, so search keeps working. When the allowance runs out, the built-in AI answers with when it resets and suggests Pro or an own key. All three numbers are env settings (see Configuration).
- **Queue.** The server answers one call per model at a time. Waiting calls go in this order: Pro questions, Free questions, Pro indexing, Free indexing. The order is decided per model call, so a question can get in partway through a long indexing job.
- **Changing a plan.** There's no payment flow yet. Pro comes from one-time codes (`XXXX-XXXX`, stored in the `vouchers` collection): create them with `npm run vouchers:create -- <count>` in `apkh-api/`, and users redeem them in Profile > Plan > **Upgrade**. An admin can also run `npm run plan:set -- user@example.com pro` (or `free`).
- **Hardware.** No GPU needed. Both models together take about 6 GB of RAM and run on a CPU. Expect roughly 4–10 words per second depending on the CPU (an Intel i5-8400 does about 4), so a typical answer takes 15–60 seconds, plus a few seconds to load the model after it has been idle. For more speed, set `BUILTIN_AI_CHAT_MODEL=qwen3.5:2b` (then `ollama pull qwen3.5:2b`); for many users at once, a GPU server (then raise `BUILTIN_AI_CHAT_SLOTS` and Ollama's `OLLAMA_NUM_PARALLEL` together).
- **Free hosting.** Oracle Cloud's Always Free Arm VM (2 cores and 12 GB of RAM as of 2026) fits Ollama and all four services; use MongoDB Atlas's free tier for the database. With only 2 cores, `BUILTIN_AI_CHAT_MODEL=qwen3.5:2b` keeps answers at a usable speed. Install Ollama on the VM with `curl -fsSL https://ollama.com/install.sh | sh`, then pull the two models and set `OLLAMA_CONTEXT_LENGTH=8192` in the Ollama service environment.
- **Another server.** `BUILTIN_AI_BASE_URL` can point at any OpenAI-compatible server (llama.cpp, vLLM, a hosted endpoint). Keep the embedding model Qwen3-Embedding-0.6B, because stored vectors are labelled with it.

## AI assistants (MCP)

`apkh-mcp/` is an MCP server, so Claude Code, Claude Desktop or Cursor can search, read and add your notes (`search_notes`, `get_note`, `create_note`). `setup-all.bat` builds it. To connect Claude Code:

1. Create a token with **Can read and search notes** in Profile → Integrations (or run `npm run token:create -- you@example.com "Claude Code" --read` in `apkh-api/`).
2. Register the server:

   ```bash
   claude mcp add apkh --scope user --env APKH_API_URL=http://localhost:3000 --env APKH_TOKEN=apkh_… -- node "<repo>/apkh-mcp/dist/index.js"
   ```

3. Ask *"search my notes for …"*.

Details and other clients: [apkh-mcp/README.md](apkh-mcp/README.md).

## Debugging in VS Code

`.vscode/launch.json` has a configuration per service and **🚀 Run All Services (Debug)** to start all four with the debugger attached (Run and Debug panel).

## macOS / Linux

There are no scripts for these yet; the steps are the same by hand:

```bash
# Install
for d in apkh-api apkh-storage apkh-web; do (cd $d && npm install); done
cd apkh-search && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

# Env files (then fill in MONGODB_URI)
node scripts/init-env.mjs

# Start, one terminal each
cd apkh-api && npm run start:dev
cd apkh-storage && npm start
cd apkh-search && .venv/bin/python main.py
cd apkh-web && npm run dev
```

## URLs

| | |
|---|---|
| Web app | http://localhost:3002 |
| API + Swagger docs | http://localhost:3000, http://localhost:3000/api |
| Storage | http://localhost:3001 |
| Search service docs | http://localhost:8000/docs |

## Troubleshooting

- **"Invalid or expired token" / 401 between services**: `JWT_SECRET` differs between `apkh-api`, `apkh-storage` and `apkh-search`. Make it identical and restart them.
- **`Atlas Vector Search failed …` in the API log**: the index is missing, not READY yet, or the database isn't Atlas. Search keeps working (similarity computed in the API) and Atlas is retried every 10 minutes. The API logs where each search ran (`Passage search: Atlas Vector Search (…ms)`).
- **"The built-in AI isn't available right now"**: Ollama isn't running or a model isn't pulled. The search-service log names the model and URL it tried. Run `ollama list`, and `ollama pull qwen3.5:4b` / `ollama pull qwen3-embedding:0.6b` for anything missing.
- **"The built-in AI is busy right now"**: a request waited in the queue longer than the API's timeout. Many users are asking at once for one CPU: switch to `qwen3.5:2b`, or add hardware. The search-service log shows `waited …s for a slot` lines when the queue gets long.
- **Built-in AI summaries of long notes look cut off**: Ollama is using its default context window. Set `OLLAMA_CONTEXT_LENGTH=8192` and restart Ollama.
- **Notes stay "Indexing" or "Failed"**: check the AI key in Profile (or that Ollama is running for the built-in AI), then use Profile > Search index > **Retry failed**. Claude keys index for keyword search only (Anthropic has no embedding model), and so do OpenRouter keys without credit (its embedding model is paid; the chat models are free).
- **Quota / rate-limit errors when testing a key**: the provider refused the request (e.g. a free tier without access to that model). Pick another model or enable billing with the provider.
- **`start-all.bat` opens nothing**: run it from a terminal to see the message; without Windows Terminal it opens separate windows instead of tabs.
