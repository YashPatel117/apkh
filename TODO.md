# TODO

Legend: [x] done · [~] backend done, web UI still to do · [ ] not started — everything below is done

## 🔴 P0 — Fix First

- [x] Add file size limits to storage uploads (50 MB/file, 10 files/request) — storage + API multer
- [x] Add per-user storage quota (`USER_QUOTA_MB`, default 1024)
- [x] Add rate limiting on upload endpoints (`express-rate-limit`, per user)
- [x] Replace sync file I/O in storage service with `fs.promises`
- [x] Pin Python dependency versions in `apkh-search/requirements.txt`
- [x] Validate max text length / chunk count / file size in Python routes (`services/limits.py`)

## 🟡 P1 — Performance & Reliability

- [x] Stream AI answers via SSE — search: `/ai-search/rag/stream`, `/ai-search/chat-rag/stream`; API: `POST /notes/ai-search/stream`, `POST /chat/session/:id/message/stream`. Web: `useAiSearch` in layout, `AiAnswerPanel` shows text as it streams, chat page streams replies (`sendChatMessageStream`)
- [x] Export notes: note card ⋯ menu → Markdown / ZIP with attachments / Print or save as PDF (`/print/[id]`, always light)
- [x] Bulk export → ZIP: "Your data" card in Profile (also in the command palette)
- [x] Paginate notes: API `GET /notes?limit&cursor&q&category&folderId`; store (`noteSlice`); infinite scroll on notes page (IntersectionObserver + Load more fallback). Sidebar counts come from server `categories` / `totalNotes`
- [x] Debounce filter + server `?q=`: `useNotesFilter` wired into the layout
- [x] Split `(home)/layout.tsx` into hooks: `useAuth`, `useNoteEditor`, `useAiSearch`, `useNotesFilter`, `useOfflineSync`, `useRealtime`
- [x] ETag / If-None-Match (global `RevalidateInterceptor`, verified 304)
- [x] `/health` and `/ready` on API, storage, search
- [x] React error boundaries: `components/errorBoundary.tsx` around the editor, AI answer and every file preview (`FileDisplay`); route `error.tsx` for (home), chat and notes
- [x] Configure MongoDB connection pool
- [x] Graceful shutdown: storage (SIGTERM/SIGINT), search (`timeout_graceful_shutdown`), API `enableShutdownHooks()`

## 🔵 P2 — Architecture & UX

- [x] Structured logging + correlation IDs (API nestjs-pino, storage pino, search structlog; `X-Request-Id` forwarded)
- [x] Collections / nested folders: sidebar tree (create / rename / delete / nest), drag note cards onto folders and folders into folders, "Not in a folder", breadcrumbs + subfolders on the notes page, "Move to folder…" in the card menu; new notes go into the open folder
- [x] Keyboard shortcuts: Alt+N (Ctrl/⌘+N in the installed app), / and Ctrl+Shift+F search, arrows / J K between note cards, X pins, ? shows them all (`ShortcutsDialog`)
- [x] Command palette on Ctrl/⌘+K: notes (server search), ask AI, actions, pages, folders, theme, language, export, sign out
- [x] Slash commands in the editor: text, H1–H3, lists, checklist, quote, code block, today's date, attach file (`components/slashCommands.tsx`)
- [x] Offline: `offlineQueue`/`offlineCache`/`useOfflineSync` wired into the layout, offline/syncing banner, Ask AI disabled offline; `public/sw.js` v2 keeps pages network-first and serves the kept shell offline (SW only registers in production builds — test with a prod build)

## 🟣 P3 — New Features

- [x] Usage analytics: `/analytics` ("Usage" in the sidebar): totals, tokens per day by use (stacked, with table view), notes per day, most asked, per-model cost; 7/30/90 days
- [x] Real-time sync: API socket.io gateway `/realtime` (events: note:saved, note:deleted, notes:refresh, folders:changed, index:changed, chat:updated, profile:changed). `useRealtime` runs from the layout; `useIndexStatusSync` polls every 60s while connected; chat page reloads the open conversation on `chat:updated` from elsewhere
- [x] Note version history: card ⋯ menu → Version history (word diff against the current note, restore)
- [x] Admin panel: `/admin` (sidebar link for ADMIN_EMAILS only): overview, indexing queue + recent failures, AI last day, users with plan switch, Pro vouchers
- [x] Integrations: Integrations card in Profile (tokens, email inbox, curl example); `apkh-clipper/` MV3 extension (popup + right-click, see its README); "Add to calendar (.ics)" for dated tasks/deadlines in the Action items summary
- [x] i18n: English, Spanish and Hindi for the whole web app (673 messages in `src/i18n/messages/`), Language card in Profile and in the command palette; first visit follows the browser's language. Server error messages stay as the API sends them

## Notes for the next session

- Work is on branch `feature/todo-roadmap`; merge to `master` when the remaining items are done.
- Everything type-checks: `apkh-api` (`npx tsc --noEmit -p tsconfig.json`) and `apkh-web` (`npx tsc --noEmit`). 
- New deps were installed: storage (express-rate-limit, pino, pino-http), API (archiver@7, turndown, marked, sanitize-html, nestjs-pino, socket.io, @nestjs/websockets), web (socket.io-client, diff), search venv (structlog — run `pip install -r requirements.txt`).
- New env vars are in each `.env.example` (ADMIN_EMAILS, PUBLIC_API_URL, INBOUND_EMAIL_DOMAIN, USER_QUOTA_MB, LOG_LEVEL…).
- The layout rewrite is done (2026-10-05): type-check + lint clean, routes compile in `next dev`; **not yet clicked through against a live API** (streaming, realtime, offline sync).
- `NotesContext` now exposes `activeFolder` / `setActiveFolder` (and `newNote` files into the open folder), ready for the folder sidebar tree.
- 2026-10-05 (later): all remaining UI + the not-started items done. Checked in Chrome against a mocked API (Playwright): folders, palette, shortcuts, arrows, history, slash commands, analytics (light/dark), admin, profile, Spanish, print. **Not yet tried against the live API** (moves, restores, exports, tokens) and the clipper hasn't been loaded in Chrome.
- 2026-10-05: i18n finished; branch merged to `master`.
