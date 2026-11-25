---
description: Build a feature with the agent team in parallel (contract-first)
argument-hint: <feature description>
---

Build this feature: **$ARGUMENTS**

If `.claude/agent-kit.json` has `"configured": false`, stop and tell me to run `/setup-agents` first.

Otherwise follow the orchestrator workflow in CLAUDE.md exactly:

1. **Contract + plan**: update the contract source if needed, write `docs/plans/<feature-slug>.md` from the template (pin every cross-agent name, tasks per agent), create shared skeletons, run codegen. Ask me only if an ambiguity changes the contract.
2. **Packages**: install anything the plan needs.
3. **Parallel build**: launch every team agent with tasks in the plan in ONE message so they run at the same time.
4. **Integrate**: handle every "Needs from orchestrator", wire shared files, run the full check, fix failures (re-launch owning agents in parallel for bigger fixes), then run review/test agents if the team has them.
5. **Report**: what was built, files per agent, check results, open issues.
