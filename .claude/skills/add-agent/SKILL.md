---
name: add-agent
description: Add, change, or remove one agent in this project's agent team, keeping ownership, CLAUDE.md, the dashboard config, and agent-kit.json in sync.
disable-model-invocation: true
argument-hint: "<what the agent should do>  |  remove <name>  |  change <name>: <what>"
---

# Add / change / remove an agent

Request: **$ARGUMENTS**

1. Read `.claude/agent-kit.json`, `docs/ownership.md`, `.claude/ownership.json`, `AGENTS.md`, and the existing `.claude/agents/*.md`. If the kit isn't configured, tell the user to run `/setup-agents` first and stop.
2. Work out: name (kebab-case), role, owned paths, tools (read-only?), model, quick check, which skills it should follow. Ask the user (AskUserQuestion) only about what you can't infer.
3. **Ownership conflicts**: if the new globs overlap an existing agent's, propose how to split (move paths, or narrow globs) and get a yes before changing the other agent.
4. Show a short summary and confirm. Then update **all** of:
   - `.claude/agents/<name>.md` (from `.claude/kit/templates/agent.md`, fully filled, stack-specific)
   - other agents' files if their ownership changed
   - `docs/ownership.md` (table + Shared boundaries)
   - `.claude/ownership.json`
   - `CLAUDE.md` Team table (inside the `agent-kit:orchestrator` markers)
   - `docs/plans/_template.md` if it lists agents
   - `.claude/agent-kit.json` → `agents`
   - commands that name agents explicitly (e.g. `/review`)
5. **Remove**: delete the agent file, hand its paths to another agent or the orchestrator (ask which), and update the same list.
6. Check: no placeholders left, no overlapping globs. Report what changed; mention a restart may be needed for the agent to appear.
