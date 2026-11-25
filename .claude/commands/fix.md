---
description: Fix a bug: reproduce, hand to the owning agent(s), check, review
argument-hint: <bug description>
---

Fix this bug: **$ARGUMENTS**

If `.claude/agent-kit.json` has `"configured": false`, stop and tell me to run `/setup-agents` first.

1. **Locate and reproduce.** Find the code path (web component → web-data service/hook → API controller/service → search/storage). Reproduce without a dev server where possible: read the code, add a minimal script, or run the area's quick check. Do not start long-running servers yourself unless I ask. State the root cause in 1–3 sentences with `file:line`. If you can't find it, tell me what you checked and ask for steps/logs instead of guessing.
2. **Decide the owners** from `docs/ownership.md`. If the fix changes a cross-agent name or a DTO, write a short `docs/plans/fix-<slug>.md` (shared names + tasks per agent) and run `scripts/codegen.ps1` after the api change.
3. **Fix.**
   - Fix in orchestrator-owned files (entry points, manifests, config, scripts) or a one-line obvious fix: do it yourself.
   - Otherwise launch the owning agent(s) with the root cause, the exact files, and the expected behaviour. Several owners → **all in ONE message** in parallel.
4. **Check**: handle "Needs from orchestrator", run `scripts/check.ps1` (or the affected areas' checks), and re-launch owners with the error output if it fails.
5. **Review**: run the `reviewer` agent on the diff; add `security-reviewer` in the same message if the bug touches auth, access, uploads, sharing, tokens or HTML rendering.
6. **Report**: root cause, files changed per agent, check results, review verdict, and how I can verify it in the app.
