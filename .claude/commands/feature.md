---
description: Build a feature with the agent team in parallel (contract-first)
argument-hint: <feature description>
---

Build this feature: **$ARGUMENTS**

If `.claude/agent-kit.json` has `"configured": false`, stop and tell me to run `/setup-agents` first.

Otherwise follow the orchestrator workflow in CLAUDE.md exactly:

1. **Contract + plan**: if `docs/plans/<feature-slug>.md` already exists (from `/plan`), use it; otherwise write it from the template (pin every cross-agent name, tasks per agent). Check `ROADMAP.md` for a matching item. Ask me only if an ambiguity changes the contract.
   - **DTO changes come first**: when the plan adds or changes API request bodies, write the DTO classes yourself (as skeletons with their validators) in the api module, then run `scripts/codegen.ps1` so `openapi.json` and `apkh-web/src/services/api-schema.d.ts` exist before web-data starts. The api agent then fills in controllers and services.
   - Create other shared skeletons both sides need (e.g. a new Mongo schema file, a new search-api client method signature).
2. **Packages**: install anything the plan needs (`npm install` in the package, or pin in `apkh-search/requirements.txt` and install into `apkh-search/.venv`).
3. **Parallel build**: launch every team agent with tasks in the plan (api, web-ui, web-data, search, satellites) in ONE message so they run at the same time.
4. **Integrate**: handle every "Needs from orchestrator" (register modules in `apkh-api/src/app.module.ts`, routers in `apkh-search/main.py`, providers in `apkh-web/src/app/providers.tsx`, env vars in `scripts/init-env.mjs`), run `scripts/codegen.ps1` again if any DTO changed, then `scripts/check.ps1`. Fix failures (re-launch owning agents in parallel for bigger fixes). Then run `reviewer` and `security-reviewer` in ONE message and route blockers back to owners. Update `ARCHITECTURE.md` and tick the `ROADMAP.md` item when behaviour changed.
5. **Report**: what was built, files per agent, check results, review verdict, open issues, and how to try it in the app.
