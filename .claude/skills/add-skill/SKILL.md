---
name: add-skill
description: Create or update a project skill (a reusable, step-by-step recipe in .claude/skills) for this project's stack, and link it to the agents that should use it.
disable-model-invocation: true
argument-hint: "<what the skill should do, e.g. 'add a REST endpoint end to end'>"
---

# Add / update a skill

Request: **$ARGUMENTS**

1. Read `.claude/agent-kit.json` (stack, agents, existing skills) and `AGENTS.md` conventions. Look at real code in the repo that does the same kind of task — the skill must match how this project actually does it.
2. Decide: name (kebab-case), trigger description (concrete: "Use when …"), whether only the user may trigger it (`disable-model-invocation: true` for anything with side effects like deploys or migrations against a DB), arguments, and whether it needs scripts (only for deterministic multi-step work).
3. Ask the user (AskUserQuestion) only about what you can't infer — e.g. which agents should use it.
4. Create `.claude/skills/<name>/SKILL.md` from `.claude/kit/templates/skill.md`: exact steps with this project's paths, the rules that apply, a real example, a verify step. Keep SKILL.md focused; long reference material goes in sibling files linked from it. Scripts go in `.claude/skills/<name>/scripts/`.
5. Link it: add it to the "follow these skills" line of each relevant agent in `.claude/agents/`, and to `.claude/agent-kit.json` → `skills` (name, description, usedBy).
6. If a script was added, run it once on a harmless input (or `--help`) to prove it works.
7. Report: what the skill does, how it's triggered (`/<name>` and/or automatically), which agents use it.
