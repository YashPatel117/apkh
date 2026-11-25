---
description: Open the agent activity dashboard (live view + history of every task)
---

Start the agent activity dashboard:

1. Run `node .claude/dashboard/server.js --open` **in the background** (run_in_background), from the project root.
2. If it says "already running", that's fine — the browser was opened anyway.
3. Tell the user: dashboard is at http://localhost:4317 (or `$DASH_PORT`), it updates live, and history is stored in `.claude/activity/events.jsonl` (delete that folder to clear history).

Do nothing else.
