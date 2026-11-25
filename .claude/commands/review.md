---
description: Run the reviewer and security-reviewer agents on the current changes
argument-hint: [plan path or focus, optional]
---

Review the current changes. Focus/plan (optional): **$ARGUMENTS**

1. Run `git status` and `git diff --stat` (plus `git diff` for untracked-vs-modified context). If nothing changed, say so and stop.
2. Find the plan: `$ARGUMENTS` if it's a path, otherwise the newest `docs/plans/*.md` matching the changes (or none).
3. Launch **`reviewer` and `security-reviewer` in ONE message** (parallel). Give each: the plan path (if any), the changed files list, and the focus from `$ARGUMENTS`.
4. Merge their reports into one list, de-duplicated, sorted by severity, each with `file:line`, problem, owning agent and suggested fix.
5. Do not fix anything unless I ask. Offer: "Fix the blockers?" and, if I agree, route each fix to its owning agent (independent owners in ONE message), then run `scripts/check.ps1`.
