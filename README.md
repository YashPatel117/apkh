# AI-Powered Personal Knowledge Hub

A note-taking app with an AI layer: write rich notes with attachments, then ask questions and get answers grounded in your own notes, with numbered citations that jump to the exact passage or file page. It works without any AI key: a **free built-in AI** (open-source models the server runs itself through Ollama) serves every user. Users can add their own key (OpenRouter, Gemini, OpenAI or Claude) for faster, stronger models; OpenRouter's free models also cost nothing.

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
5. if Ollama is installed, downloads the free AI models (`qwen3.5:4b`, `qwen3-embedding:0.6b`, about 4 GB) and sets `OLLAMA_CONTEXT_LENGTH=8192` for your Windows user, so long notes fit (restart Ollama once afterwards). Without Ollama this step only prints how to add it.

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

Open http://localhost:3002 and register. The **Free AI** is active straight away, and your notes are indexed in the background. To use your own key instead, go to **Profile > AI models > Add key**: pick the provider, pick a model from the live list, **Test connection**, then **Save & activate**. You can switch back to the Free AI there at any time.

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
| | `FREE_AI` | on | `off` hides the free built-in AI (users then need their own key) |
| `apkh-storage/.env` | `JWT_SECRET`, `CORS_ORIGINS`, `PORT` | | |
| `apkh-search/.env` | `JWT_SECRET`, `CORS_ORIGINS`, `STORAGE_API_URL` | | |
| | `FREE_AI_BASE_URL` | `http://localhost:11434/v1` | Ollama, or any OpenAI-compatible server |
| | `FREE_AI_CHAT_MODEL` | `qwen3.5:4b` | `qwen3.5:2b` is about twice as fast |
| | `FREE_AI_EMBEDDING_MODEL` | `qwen3-embedding:0.6b` | That server's name for Qwen3-Embedding-0.6B; don't change the model |
| | `FREE_AI_VISION`, `FREE_AI_API_KEY` | on, none | `off` for a chat model that can't read images; a key only if the server needs one |
| | `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` | tracing off | Optional LangSmith tracing |
| `apkh-web/.env.local` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_URL` | localhost | Use your LAN IP to open the app from other devices |

To open the app from a phone or another computer, put your machine's LAN IP in `apkh-web/.env.local` and add `http://<lan-ip>:3002` to `CORS_ORIGINS` in the API and storage env files.

## The free AI

Users without a key share open-source models that run on your server: **Qwen3.5 4B** for answers, summaries and reading images, and **Qwen3-Embedding-0.6B** for search by meaning. Nobody pays and nobody has a quota; your server's capacity is the limit.

- **Hardware.** No GPU needed. Both models together take about 6 GB of RAM and run on a CPU. Expect roughly 4–10 words per second depending on the CPU (an Intel i5-8400 does about 4), so a typical answer takes 15–60 seconds, plus a few seconds to load the model after it has been idle. Requests are answered one at a time and the others wait. For more speed, set `FREE_AI_CHAT_MODEL=qwen3.5:2b` (then `ollama pull qwen3.5:2b`); for many users at once, a GPU server.
- **Free hosting.** Oracle Cloud's Always Free Arm VM (2 cores and 12 GB of RAM as of 2026) fits Ollama and all four services; use MongoDB Atlas's free tier for the database. With only 2 cores, `FREE_AI_CHAT_MODEL=qwen3.5:2b` keeps answers at a usable speed. Install Ollama on the VM with `curl -fsSL https://ollama.com/install.sh | sh`, then pull the two models and set `OLLAMA_CONTEXT_LENGTH=8192` in the Ollama service environment.
- **Another server.** `FREE_AI_BASE_URL` can point at any OpenAI-compatible server (llama.cpp, vLLM, a hosted endpoint). Keep the embedding model Qwen3-Embedding-0.6B, because stored vectors are labelled with it.

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
- **"The free AI model isn't available right now"**: Ollama isn't running or a model isn't pulled. The search-service log names the model and URL it tried. Run `ollama list`, and `ollama pull qwen3.5:4b` / `ollama pull qwen3-embedding:0.6b` for anything missing.
- **Free AI summaries of long notes look cut off**: Ollama is using its default context window. Set `OLLAMA_CONTEXT_LENGTH=8192` and restart Ollama.
- **Notes stay "Indexing" or "Failed"**: check the AI key in Profile (or that Ollama is running for the free AI), then use Profile > Search index > **Retry failed**. Claude keys index for keyword search only (Anthropic has no embedding model), and so do OpenRouter keys without credit (its embedding model is paid; the chat models are free).
- **Quota / rate-limit errors when testing a key**: the provider refused the request (e.g. a free tier without access to that model). Pick another model or enable billing with the provider.
- **`start-all.bat` opens nothing**: run it from a terminal to see the message; without Windows Terminal it opens separate windows instead of tabs.
