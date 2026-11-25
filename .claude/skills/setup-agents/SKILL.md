---
name: setup-agents
description: Set up (or redo) this project's AI agent team for any tech stack — interviews the user about stack and roles, then generates agents, skills, commands, ownership map, AGENTS.md/CLAUDE.md, and check scripts. Run once after installing agent-kit.
disable-model-invocation: true
argument-hint: "[optional: stack and agents in one line, e.g. 'React + FastAPI + Postgres; agents: ui, api, db, tests']"
---

# Set up the agent team

You configure agent-kit for this project. Templates live in `.claude/kit/templates/`. Config lives in `.claude/agent-kit.json`. Work in the phases below, in order. Never skip the confirmation in phase 3.

If `$ARGUMENTS` is given, use it to pre-fill answers and only ask about what's still unclear.

## Phase 1 — Inspect (no questions yet)
1. Read `.claude/agent-kit.json`. If `configured: true`, tell the user this re-runs setup, show the current team, and ask whether to **reconfigure from scratch** or **adjust** (adjust = keep everything not mentioned). For small changes point them to `/add-agent`, `/add-skill`, `/add-command`.
2. Detect what already exists: dependency manifests (`package.json`, `*.csproj`/`*.sln`, `pyproject.toml`/`requirements.txt`, `go.mod`, `pom.xml`/`build.gradle`, `Cargo.toml`, `composer.json`, `Gemfile`, `pubspec.yaml`…), framework configs (`angular.json`, `next.config.*`, `vite.config.*`…), folder layout, test setup, linters, existing `.claude/agents`, `.claude/skills`, `.claude/commands`, existing `AGENTS.md`/`CLAUDE.md` content, OS (for script flavour).
3. Summarise what you found in 3–6 lines.

## Phase 2 — Interview
Ask with the AskUserQuestion tool (max 4 questions per call; use multiSelect where choices combine; put your recommendation first, marked "(Recommended)"). Skip anything already answered by `$ARGUMENTS` or detection. Cover:

1. **Stack per area** — frontend / backend / database / mobile / infra / other: framework + version, and folder (propose folders if the project is empty, e.g. `src/web`, `src/api`).
2. **Contract between areas** — OpenAPI / GraphQL schema / .proto / shared types package / DB schema only / none. Propose the natural one for the stack, plus its codegen tool per side.
3. **Agents** — propose a team derived from the stack, then let the user add/remove/rename. Typical building blocks (pick what fits, don't force all):
   - UI/design (templates, styles, presentational components) · client logic (state, services, API calls)
   - API/endpoints (HTTP layer, validation) · domain/business logic · data (schema, migrations, queries)
   - mobile · infra/devops (Docker, CI, IaC) · integration/tests (writes tests from the plan in parallel)
   - reviewer (read-only, runs after integration) · security reviewer (read-only) · docs
   Rule of thumb: split an area into two agents only when both halves are big and can be pinned by a shared name list; otherwise one agent per area. 3–6 builders is the sweet spot.
4. **Per-agent model** (optional) — inherit (default) / opus for heavy logic / haiku for light work.
5. **Skills** — propose stack-specific, repeatable recipes, e.g. "add API endpoint", "add UI page/component", "create DB migration", "write tests for X", "add env/config value". Ask which to create.
6. **Commands** — `/feature` is always included. Offer extras: `/fix <bug>` (reproduce → owning agent → check), `/review` (reviewer agents on current changes), `/plan <feature>` (plan only, no build), `/test`, `/scaffold` (create the projects if folders are empty). Let the user name their own.
7. **Conventions** — offer sensible defaults for the stack (they can accept all), plus anything they want enforced.
8. **Check commands** — build/test/lint per area; propose the standard ones for the stack.

Ask only what matters; don't make the user answer things with obvious defaults — state the default instead.

## Phase 3 — Confirm
Show one compact summary: stack table, contract + codegen, agents table (name · owns · quick check · model), skills, commands, checks. Ask: "Create this?" Apply any edits, then continue.

## Phase 4 — Generate
Create/update these (use `.claude/kit/templates/*` as the starting shape; fill every `<…>` and `FILL` — no placeholders may remain):

1. **`.claude/agents/<name>.md`** for each agent, from `templates/agent.md`:
   - concrete, stack-specific "How to work" steps and conventions (real file paths, real patterns for that framework/version)
   - ownership globs **must not overlap** with any other agent or the orchestrator
   - read-only agents: `tools: Read, Grep, Glob, Bash`, and say they never edit files
   - list the skills it should follow
2. **`.claude/skills/<name>/SKILL.md`** for each skill, from `templates/skill.md` — real steps, real paths, a real example in the stack. Add `scripts/` only for deterministic multi-step work.
3. **`.claude/commands/<name>.md`** for each extra command, from `templates/command.md`. Update `.claude/commands/feature.md` if the workflow needs stack-specific steps (e.g. scaffold when folders are empty).
4. **`docs/ownership.md`** — full table (orchestrator, generated, every agent), quick checks, and the **Shared boundaries** section for each pair of agents that meet.
5. **`.claude/ownership.json`** — `{ "agents": { "<name>": ["<glob>", …] }, "generated": ["<glob>"] }` — same globs as ownership.md, agents in the order you want them shown on the dashboard.
6. **`AGENTS.md`** — fill every FILL section. If the file had user content before the kit, keep it and merge.
7. **`CLAUDE.md`** — keep `@AGENTS.md` at the top; fill the Team table inside the `agent-kit:orchestrator` markers. If the markers are missing (pre-existing CLAUDE.md), append the block from `templates/CLAUDE.md`. Never delete user content outside the markers.
8. **`docs/plans/_template.md`** — adapt "Shared names" and "Tasks per agent" to this team.
9. **Scripts** in `scripts/` — `check` (full build + lint + test for every area, non-zero exit on failure) and, if there's a contract, `codegen`. PowerShell `.ps1` on Windows, `.sh` elsewhere (both if the user wants cross-platform). Each script must skip areas whose folders don't exist yet, with a message.
10. **`.claude/agent-kit.json`** — set `configured: true` and record project, stack, contract, checks, agents (name, owns, model, readOnly), skills, commands.

Do NOT scaffold the actual application unless the user asked to in phase 2/3.

## Phase 5 — Verify and hand over
1. Re-read every generated agent and check: no `<…>`/FILL left, no overlapping globs (compare all agents' globs pairwise), every skill referenced by an agent exists.
2. Run the check/codegen scripts once if the areas exist (report results honestly; skipping is fine for empty areas).
3. Tell the user, briefly: what was created (grouped), how to use it (`/feature <description>`, extra commands, `/dashboard`), how to change it later (`/add-agent`, `/add-skill`, `/add-command`, or re-run `/setup-agents`), and that a restart of Claude Code may be needed for new agents/commands to appear in menus.
