# Project rules (all agents, all tools, all models)

<!-- agent-kit: this file is read by Claude Code (via CLAUDE.md), Codex, Cursor, Copilot, Gemini CLI and others.
     /setup-agents fills the FILL sections. Edit freely afterwards. -->

## Project
**AI-Powered Personal Knowledge Hub (APKH)**: a personal notes app with AI. Users write notes (Quill editor) in folders with tags and `[[links]]`, attach files, and get AI search, chat and summaries over everything they saved, using their own AI key (OpenRouter, Gemini, OpenAI, Anthropic, Claude Code) or a built-in, self-hosted model. They can share notes by link and folders with other users, import from Obsidian/Notion/Evernote, and reach their notes from other tools through a browser clipper and an MCP server. `README.md` covers setup; `ARCHITECTURE.md` explains how the services work together; `ROADMAP.md` lists what's done and what's next.

## Stack
| Area | Tech + version | Folder | Build | Test | Lint / types |
|---|---|---|---|---|---|
| API | NestJS 11, Mongoose 8 (MongoDB, Atlas vector search), socket.io, pino, Node 22 | `apkh-api` | `npm run build` | none yet | `npx eslint "src/**/*.ts"` · `npx tsc --noEmit` |
| Web | Next.js 15 (App Router, Turbopack), React 19, Redux Toolkit, Tailwind 4, axios | `apkh-web` | `npm run build` | none yet | `npx eslint` · `npx tsc --noEmit` |
| AI engine | FastAPI 0.118, Pydantic 2, LangChain 1.2, Python 3.11 (`.venv`) | `apkh-search` | `python -m compileall -q main.py routes services` | none yet | `python -c "import main"` (env `JWT_SECRET=ci-only BUILTIN_AI=off`) |
| File storage | Express 5, MongoDB GridFS, multer (CommonJS) | `apkh-storage` | — | none yet | `node --check server.js` |
| MCP server | `@modelcontextprotocol/sdk`, zod, TypeScript (ESM) | `apkh-mcp` | `npm run build` | `npm run smoke` (needs a running API) | `npx tsc --noEmit` |
| Clipper | Browser extension, Manifest V3, plain JS | `apkh-clipper` | — | — | `node --check *.js` |
| Infra | GitHub Actions, Hugging Face Space (Docker) | `.github`, `deploy` | — | — | — |

**Full check:** `pwsh scripts/check.ps1` (all areas, same as CI minus the Docker image; `-NoBuild` for lint + types only; pass areas to limit: `api web search storage mcp`).

## Repository layout
```text
apkh-api/        NestJS API: auth, notes, folders/collab, chat, AI search + retrieval, indexing queue, files, integrations
apkh-web/        Next.js app: src/app routes, src/components UI, src/services API clients, src/store Redux, src/hooks
apkh-search/     FastAPI AI engine (stateless): extract, chunk, embed, RAG/chat/summaries, transcription, providers
apkh-storage/    Express file service: attachments in MongoDB GridFS
apkh-mcp/        MCP server (stdio): search_notes, get_note, create_note over /integrations/*
apkh-clipper/    Browser extension that clips pages into notes
deploy/          Hugging Face Space image (API + search + storage in one container)
scripts/         init-env.mjs (env files), check.ps1 (full check), codegen.ps1 (API contract → web types)
docs/            ownership.md, plans/ (feature plans)
.github/         CI workflow
```

## Single source of truth
- **API contract:** `apkh-api/openapi.json`, generated from the Nest DTO classes (`@nestjs/swagger` plugin + `class-validator`). `apkh-web/src/services/api-schema.d.ts` is generated from it, and web services type request bodies with `ApiBody<"DtoName">` (`apkh-web/src/services/api-types.ts`). Regenerate both with `pwsh scripts/codegen.ps1` (orchestrator only). CI fails when either is stale. Responses are not described in the contract yet: the feature plan pins them.
- **api ↔ apkh-search** has no generated contract: `apkh-api/src/search-api/search-api.client.ts` and the Pydantic models in `apkh-search/routes/*` must match the plan.
- The feature plan in `docs/plans/<feature>.md` pins down every name that crosses agent boundaries (interfaces, function signatures, component members, events). Follow it exactly — same names, same signatures.
- Never edit generated code. Need a change? Report it; the orchestrator updates the source and regenerates.

## Ownership
Each agent edits **only** the paths it owns — see `docs/ownership.md`. Reading anything is fine.

## Forbidden for sub-agents (orchestrator only)
- git commands of any kind
- installing/removing packages or editing dependency manifests
- running code generation
- starting dev servers / long-running processes
- full builds or the full test suite — use the quick check for your own area instead

If you need any of these, put it under **"Needs from orchestrator"** in your final report and continue.

## Conventions
- **All:** no secrets in code (env vars only, added to `scripts/init-env.mjs`). Never log keys, JWTs or integration tokens. Comments explain *why*, in plain sentences. Match the style of neighbouring files. Behaviour changes are reflected in `ARCHITECTURE.md` (orchestrator).
- **apkh-api (TypeScript, Nest):** one module per feature (`controller` + `service` + `module` + `dto/`), schemas in `src/common/schema/`, migrations in `src/database/migrations.service.ts`. DTOs use `class-validator` + `@ApiProperty`, every string has `@MaxLength`. Protected routes: `@UseGuards(AuthGuard)`, `@JwtTokenUserId()`, every query scoped by `userId` (or folder membership). `@RateLimit` on AI, auth, import and public routes. Errors as Nest `HttpException`s with short user-facing messages. pino logger, no `console.log`. Prettier formatting (single quotes).
- **apkh-web (TypeScript, React):** `app/` holds routes only; feature UI in `components/` (camelCase files), primitives in `components/ui/`. Components never call axios: they use `services/` via hooks. Request bodies typed with `ApiBody<"…">`. Every visible string through i18n (`en.ts`, `es.ts`, `hi.ts`). Tailwind + `cn()`. Client components marked `"use client"`. Double quotes.
- **apkh-search (Python):** stateless (no DB, keys per request, never stored). One `APIRouter` per file, Pydantic v2 models, snake_case JSON. Provider logic only in `services/providers.py` / `services/llm.py`. Blocking work off the event loop. `logging.getLogger(__name__)` (structlog). Provider errors → their one-line message + fitting status.
- **apkh-storage / apkh-mcp / clipper:** JWT/token checks on every route, quotas and upload limits kept, idempotent data scripts; MCP tool descriptions written for an AI caller.
- **Tests:** no suites yet (ROADMAP 1.2). Every change passes `scripts/check.ps1`; the plan lists manual checks against the live stack.

## Final report format (every sub-agent)
```
## Done
- files created/changed
## Assumptions
## Needs from orchestrator
- (packages, contract changes, wiring, anything outside my ownership)
## Quick check result
```
