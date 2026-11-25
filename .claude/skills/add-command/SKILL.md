---
name: add-command
description: Create or update a project slash command (.claude/commands/<name>.md) that drives this project's agent team.
disable-model-invocation: true
argument-hint: "<name and what it should do, e.g. 'fix: reproduce a bug, fix it with the owning agent, run checks'>"
---

# Add / update a command

Request: **$ARGUMENTS**

1. Read `.claude/agent-kit.json` (agents, skills, checks), `CLAUDE.md`, and existing `.claude/commands/*.md`. Make sure the name doesn't clash with an existing command or skill (skills also create `/name`).
2. Decide what the command does in terms of the team:
   - which agents it launches, and which can run **in parallel** (independent work → one message, multiple Agent calls)
   - which skills it should follow
   - which checks it runs at the end and what it reports
   - what `$ARGUMENTS` means (add `argument-hint`)
   Ask the user (AskUserQuestion) only about what you can't infer.
3. Create `.claude/commands/<name>.md` from `.claude/kit/templates/command.md`. Write it as clear instructions to the orchestrator; reference CLAUDE.md's workflow instead of repeating it when it applies.
4. Add it to `.claude/agent-kit.json` → `commands` (name, description).
5. Report: how to run it (`/<name> …`), what it will do, and that a restart may be needed for it to show in the `/` menu.
