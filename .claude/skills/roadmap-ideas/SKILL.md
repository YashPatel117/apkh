---
name: roadmap-ideas
description: Finds new features that would be genuinely useful to users of this Personal Knowledge Hub (notes, AI search, chat, attachments, sharing, MCP) and adds the approved ones to ROADMAP.md in its existing style. Use when asked to brainstorm features, extend or refresh the roadmap, or "what should we build next".
argument-hint: [area or theme, e.g. "search", "mobile", "collaboration"]
---

# Roadmap ideas

## When to use
The user wants new, useful feature ideas for the app, or wants the roadmap extended or refreshed. The orchestrator runs this itself: `ROADMAP.md` is an orchestrator-owned file. No sub-agents build anything here.

## Steps
1. **Know what exists.** Read `ROADMAP.md` (every `[x]` and `[ ]` item), `README.md`, and the `ARCHITECTURE.md` sections for the area. Skim the code for the area (`apkh-web/src/app/(home)/*`, `apkh-web/src/components/*`, `apkh-api/src/*` module names, `apkh-mcp/src/tools/*`) so you never propose something already shipped or already on the roadmap. If `$ARGUMENTS` names an area, focus there.
2. **Find real user value.** Think from the user's daily loop: capture → organise → find → understand → act → come back. For each step ask what is slow, forgotten, or impossible today. Compare with what people expect from note/PKM apps (Obsidian, Notion, Reflect, Mem, Apple Notes, NotebookLM). Use web search only for that comparison, and never send anything about this project or the user.
3. **Prefer ideas that reuse what's built**: hybrid retrieval, embeddings, action-item summaries, similar notes, indexing queue, share links, folders/collab, realtime, PWA, MCP tools, the built-in AI. An idea that is "a filter + UI on an existing pipeline" beats a new subsystem.
4. **Shortlist 5–10 ideas** and show them to the user as a compact table: idea · user benefit (one line) · builds on · size (S/M/L) · services touched (web / api / search / storage / mcp) · suggested roadmap section. Rank by value ÷ effort. Flag any that need something not built yet (e.g. the email sender from 1.4).
5. **Ask which to add** (AskUserQuestion, multiSelect). Add nothing the user didn't pick.
6. **Write them into `ROADMAP.md`** in its style:
   - Put each one in the best-fitting existing section; create a new numbered `### 2.N <Title>` section (next free number) only when none fits.
   - One item: `- [ ] **Short name**: what the user can do, in plain words. How it works in one sentence, naming the existing pieces it reuses.`
   - A new section gets a **Done when:** line describing a user-visible test, like the existing sections.
   - New items are always `[ ]`. Never tick, reword or remove existing items, and don't touch "Suggested order" unless the user asks.
7. **Verify**: re-read the edited sections; no duplicates of existing items, numbering is consecutive, Markdown renders (checkbox lists, bold names).
8. Tell the user what was added and where, and that `/plan <item>` or `/feature <item>` can take any of them forward.

## Rules
- Useful to the person using the app comes first: no internal refactors, no "add tests" items (1.2 covers those), and no monetisation unless asked.
- Respect the product's principles from `ARCHITECTURE.md`: the AI provider only ever sees one request's text, keys stay encrypted, the built-in AI keeps data on the host. Ideas that would break those must say how they avoid it.
- Keep the plain, concrete voice of the existing roadmap. No marketing words.

## Example
Added under `### 2.4 Coming back every day` in `ROADMAP.md`:

```markdown
- [ ] **On this day**: the notes page shows notes created on this date in earlier years, one tap to open. A date query on `notes.createdAt`, shown as a strip above the note list.
```

And as a new section when nothing fits:

```markdown
### 2.12 Reading later
- [ ] **Read-later inbox**: links sent from the clipper or the PWA share target land in an "Inbox" folder with the page text extracted, and the AI writes a two-line gist. Reuses the clipper's `notes:write` token and the `brief` summary mode.
- [ ] **Highlights**: select text in a clipped page to save it as a quote with its source link; highlights are indexed like note text.

**Done when:** a link shared from the phone shows up in the Inbox with a gist, and a highlight from it is found by AI search.
```
