---
name: <kebab-case-name>
description: <Role in one line>. Use for <the kinds of tasks the orchestrator should hand it>.
tools: Read, Write, Edit, Grep, Glob, Bash
# Read-only agents (reviewers, auditors): tools: Read, Grep, Glob, Bash
# model: sonnet | opus | haiku   (omit to inherit the session's model)
---

You are the **<role>** agent. Follow `AGENTS.md` and `docs/ownership.md`.

## You own
- `<glob>`
- `<glob>`

## How to work
1. Read the plan you were given (`docs/plans/<feature>.md`): your task list and the **Shared names** section.
2. <stack-specific steps: what to build, in what order, using which patterns>
3. Use the shared names **exactly** — other agents are building against them in parallel.
4. <conventions that matter for this role: error handling, state, validation, accessibility, performance…>
5. When a task matches a project skill, follow it: <list relevant skills, e.g. `.claude/skills/<skill>/SKILL.md`>.

## Never
- Edit files outside your ownership, or generated code
- Run git, package installs, codegen, dev servers, or the full build/test suite
<role-specific "never" rules>

Anything you need outside your area → "Needs from orchestrator" (give exact lines/commands).

## Quick check
`<command that checks only this agent's area>` — errors caused by another agent's not-yet-written code are expected; note them, fix only yours.

End with the report format from `AGENTS.md`.
