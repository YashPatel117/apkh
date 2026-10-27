# Roadmap

Two tracks, in this order: **make what exists work reliably**, then **make it worth opening every day**. A feature counts as done when it has been used against the live stack (not a mocked API) and has a test that would catch it breaking.

## 1. Make it work properly

### 1.1 Verify every shipped flow end to end
Several features were only checked against a mocked API or not clicked through at all. Walk each one against the real API, search and storage services, and fix what breaks:

- [ ] Attachments on GridFS storage: upload, preview, download, ZIP, delete, quota message at the limit, `/usage` in Profile and the admin panel
- [ ] Moving notes and folders (drag and drop, "Move to folder…"), version history restore, Markdown / ZIP / PDF export, export of all data
- [ ] Realtime sync between two tabs, offline edits syncing on reconnect (production build, since the service worker only registers there)
- [ ] Integration tokens, email inbox, the Chrome clipper (`apkh-clipper/`), and `apkh-mcp` with a read token
- [ ] Every AI provider: built-in AI, OpenRouter (with and without credit), Gemini, OpenAI, Anthropic key, Claude Code (machine login and `setup-token`)
- [ ] The Hugging Face Space deploy (`deploy/`) from a clean clone

**Done when:** a written checklist in `deploy/README.md` (or a new `TESTING.md`) passes on a fresh install.

### 1.2 Automated tests and CI (deferred)
Not needed for now; every merge is checked by hand. Kept here for later.

- [ ] API (Jest, already set up by Nest): auth and password rules, note CRUD scoped to the owner, AI config rules (keyless Claude Code, provider change needs a key), integration token scopes, plan allowance maths
- [ ] Search (pytest): `detect_provider`, `has_credentials`, the chunker, `_normalize_actions`, Claude Code event parsing with a fake CLI script
- [ ] Storage (node:test + mongodb-memory-server): upload / replace / quota / delete
- [ ] Web: Playwright smoke run of login → create note → ask AI → export, against the real stack started with `docker compose`
- [ ] GitHub Actions: lint + type-check + tests for each package on every push and PR

### 1.3 Safety nets for user data
- [x] **Trash.** Deleting moves a note to Trash (sidebar and command palette): restore it, delete it for good, or empty the trash; notes are purged with their files and history after `TRASH_RETENTION_DAYS` (30).
- [ ] **Backups.** A documented `mongodump` routine (attachments now live in MongoDB too), and a restore test.
- [x] **Migration for old attachments.** `npm run migrate:uploads` in `apkh-storage/` copies files saved in `uploads/` before the GridFS move into GridFS (idempotent; skips files of deleted notes).

### 1.4 Account basics
- [ ] **Forgot password by email** (link or one-time code). Resetting needs the current password today, so a user who forgot it is locked out. Needs an email sender (SMTP / Resend), which also unlocks the digest in 2.4.
- [ ] Session handling: short-lived access token + refresh, "sign out everywhere", and a clear message when the token expires mid-edit (no lost text).
- [ ] Delete account (notes, files, index, chats, tokens), with the export offered first.

## 2. Make it better

### 2.1 Search by meaning for everyone
- [x] **Claude keys and Claude Code** embed with the built-in AI's Qwen3-Embedding (keyword-only while it is down, embedded once it is back).
- [ ] **OpenRouter keys without credit**: still keyword search; they would need to move to the built-in space, which re-embeds everything for users who do have credit.

Claude keys, Claude Code and OpenRouter keys without credit only got keyword search, because their providers have no free embedding model. Embed their notes with the built-in AI's Qwen3-Embedding instead (it already runs locally), while answers still come from the user's chosen model. This is the biggest quality gain available, and Claude Code users are hit by the gap right now.

**Done when:** a Claude Code user's search finds a note by meaning ("trip costs" → a note titled "Goa budget").

### 2.2 Notes that link to each other
- [x] A page per note (`/notes/<id>`): read it, follow its links, attachments, summary, and actions (title links on cards, "Open page" / "Copy link" in the card menu)
- [x] `[[` in the editor links another note (searches all notes), and a **Linked from** section under each note page lists backlinks
- [x] Tags: edited in the note editor (autocomplete from tags in use, **Suggest** asks the AI), shown on cards and note pages, filterable from the sidebar and matched by search; kept through Trash and in Markdown exports
- [ ] The graph view (`/graph`) drawn from real links and tags instead of categories only

### 2.3 Trustworthy answers
- [ ] **Why this matched**: show the matched words and the passage similarity on each search result and citation
- [ ] **Answer feedback** (helpful / not helpful). `apkh-search` already has `/feedback`; wire the buttons and store the vote with the question, so bad answers can be found and fixed
- [ ] A small retrieval test set (30–50 questions over sample notes) that runs in CI and reports hit rate, so threshold or model changes can be compared instead of guessed
- [ ] Re-rank the top passages before answering (the built-in model, or the user's model in one short call)

### 2.4 Coming back every day
- [ ] **Daily / weekly digest**: open tasks and deadlines pulled from action items, notes touched this week, one "rediscovered" older note. In the app first, by email once 1.4 exists
- [ ] **Reminders** from dated action items (browser notification via the PWA, and the existing `.ics` export)
- [ ] **Quick capture**: the PWA as a share target (share a link or image from the phone into a new note), and a global capture shortcut in the installed app
- [ ] **Saved searches and smart filters** (e.g. "has open tasks", "has attachments", "edited this week") in the sidebar

### 2.5 Getting notes in and out
- [ ] Import: Markdown folders (Obsidian), Notion export ZIP, Evernote `.enex`, keeping folders and attachments
- [ ] Voice notes: record in the app, transcribe, and index the transcript like any attachment
- [ ] Read-only share links for a single note (revocable, optional expiry)

### 2.6 Claude Code follow-ups
- [ ] Reuse one CLI process per conversation (`--resume`) for chat, so long chats don't resend the whole history every turn
- [ ] Show in Profile which account Claude Code is logged in with, and the plan's usage limit when the CLI reports it
- [ ] Let `apkh-mcp` and Claude Code work together in the docs: one setup that both answers in the app and lets Claude Code search the notes

## 3. Integrations (MCP)
- [ ] More tools: `list_notes`, `list_folders`, `summarize_note`, `similar_notes`, `append_to_note` (keeps a version)
- [ ] GitHub and Jira: `list_issues`, `get_issue`, `search_jira`, `get_jira_issue`, `save_issue_as_note`
- [ ] Remote MCP over Streamable HTTP served by the API, with OAuth sign-in instead of pasting a token
- [ ] Publish `apkh-mcp` to npm (`npx apkh-mcp`)

## 4. Plans and running it for others
Only matters once other people use a hosted copy.

- [ ] Payments (Stripe or Razorpay) setting the plan; vouchers with an expiry and a Pro duration; an admin page to create codes
- [ ] A weekly cap next to the per-session allowance, and an indexing allowance per plan (image reading is unlimited today)
- [ ] One shared built-in AI queue across several `apkh-search` instances (Redis), and the user's place in the queue while waiting
- [ ] Error tracking and uptime alerts for the three services
- [ ] Lower the embedding model's memory (it loads at about 2.9 GB with an 8K context it doesn't need)

## Suggested order
1. 1.1 verification pass
2. 1.3 trash (the attachment migration is done)
3. 2.1 search by meaning for everyone
4. 1.4 forgot password by email
5. 2.2 note URLs, links and tags
6. 2.3 and 2.4, then the rest by demand
