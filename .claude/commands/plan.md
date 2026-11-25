---
description: Write the feature plan only (contract + per-agent tasks), no build
argument-hint: <feature description>
---

Plan this feature, but do not build it: **$ARGUMENTS**

If `.claude/agent-kit.json` has `"configured": false`, stop and tell me to run `/setup-agents` first.

1. Read `docs/ownership.md`, `ARCHITECTURE.md` (sections the feature touches), `ROADMAP.md` (is it already an item? quote it), and the relevant code in each service.
2. Write `docs/plans/<feature-slug>.md` from `docs/plans/_template.md`:
   - **Contract changes**: new/changed API routes with method, path, guard, `@RateLimit`, DTO class names and fields (types + validators), and response shapes; new apkh-search routes with Pydantic models; new Mongo schemas/fields and migrations.
   - **Shared names**: every cross-agent name (DTO names, `ApiBody<"…">` uses, service functions, hooks and their return shapes, slice actions/selectors, i18n key prefix, search-api client methods, MCP tool names), with exact signatures.
   - **Tasks per agent**: only agents with real work (api, web-ui, web-data, search, satellites).
   - **Wiring (orchestrator)**: `app.module.ts`, `apkh-search/main.py` routers, `app/layout.tsx`/`providers.tsx`, packages, env vars (and `scripts/init-env.mjs`), `ARCHITECTURE.md`/`ROADMAP.md` updates, codegen.
3. Do NOT change code, the contract, or packages. Do NOT launch agents.
4. Ask me only if an ambiguity changes the contract.
5. Report: the plan path, a 5-line summary, which agents would run, open questions. Tell me `/feature` with the same description will build it from this plan.
