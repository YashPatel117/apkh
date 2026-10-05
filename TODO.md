# TODO

Legend: [x] done · [~] backend done, web UI still to do · [ ] not started

## 🔴 P0 — Fix First

- [x] Add file size limits to storage uploads (50 MB/file, 10 files/request) — storage + API multer
- [x] Add per-user storage quota (`USER_QUOTA_MB`, default 1024)
- [x] Add rate limiting on upload endpoints (`express-rate-limit`, per user)
- [x] Replace sync file I/O in storage service with `fs.promises`
- [x] Pin Python dependency versions in `apkh-search/requirements.txt`
- [x] Validate max text length / chunk count / file size in Python routes (`services/limits.py`)

## 🟡 P1 — Performance & Reliability

- [~] Stream AI answers via SSE — search: `/ai-search/rag/stream`, `/ai-search/chat-rag/stream`; API: `POST /notes/ai-search/stream`, `POST /chat/session/:id/message/stream`. Web: `hooks/useAiSearch.ts` + `services/sse.ts` written, **not wired** into `(home)/layout.tsx` / `AiAnswerPanel` / chat page yet
- [~] Export notes: API `GET /notes/:id/export?format=md|zip`; web `exportNote()` in noteService — **no UI button yet**; PDF = add print view in web
- [~] Bulk export → ZIP: API `GET /notes/export`; web `exportAllNotes()` — **no UI button yet** (put in Profile)
- [~] Paginate notes: API `GET /notes?limit&cursor&q&category&folderId`; store (`noteSlice`: setFirstPage/appendPage/byId/totalNotes) done; layout loads first 50 only. **Still to do:** infinite scroll on notes page (`useNotesFilter.loadMore`)
- [~] Debounce filter + server `?q=`: `hooks/useNotesFilter.ts` written, **not wired** (layout still filters loaded notes client-side)
- [~] Split `(home)/layout.tsx` into hooks: `useAuth`, `useNoteEditor`, `useAiSearch`, `useNotesFilter` written in `src/hooks/`, **layout not yet rewritten to use them**
- [x] ETag / If-None-Match (global `RevalidateInterceptor`, verified 304)
- [x] `/health` and `/ready` on API, storage, search
- [ ] Add React error boundaries (editor, AI answer, PDF viewer, chat)
- [x] Configure MongoDB connection pool
- [x] Graceful shutdown: storage (SIGTERM/SIGINT), search (`timeout_graceful_shutdown`), API `enableShutdownHooks()`

## 🔵 P2 — Architecture & UX

- [x] Structured logging + correlation IDs (API nestjs-pino, storage pino, search structlog; `X-Request-Id` forwarded)
- [~] Collections / nested folders: API `/folders` CRUD + `PATCH /notes/:id/folder`; `services/folderService.ts`; store has `folders`. **Still to do:** sidebar tree, drag-and-drop, breadcrumbs, folder filter
- [ ] Keyboard shortcuts (Ctrl+N — Chrome reserves it, use Alt+N too; Ctrl+Enter exists; Ctrl+Shift+F; arrow navigation)
- [ ] Command palette on Ctrl+K
- [ ] Slash commands in editor (Quill)
- [~] Offline: `lib/offlineQueue.ts`, `lib/offlineCache.ts`, `hooks/useOfflineSync.ts`, offline save in `useNoteEditor` written. **Still to do:** wire into layout, offline banner, extend `public/sw.js` to cache app shell (network-first navigations)

## 🟣 P3 — New Features

- [~] Usage analytics: API `GET /analytics?days&tz` (+ `UsageEvent` recorded on every AI call); `services/analyticsService.ts`. **Still to do:** `/analytics` page with charts
- [~] Real-time sync: API socket.io gateway `/realtime` (events: note:saved, note:deleted, notes:refresh, folders:changed, index:changed, chat:updated, profile:changed). `hooks/useRealtime.ts` written (not wired). **Still to do:** call it from the layout, make `useIndexStatusSync` slow-poll (60s) when connected
- [~] Note version history: API `GET /notes/:id/versions`, `GET …/versions/:vid`, `POST …/restore`; noteService functions. **Still to do:** UI (diff with `diff` package, already installed)
- [~] Admin panel: API `/admin/*` (ADMIN_EMAILS env), profile returns `isAdmin`; `services/adminService.ts`. **Still to do:** `/admin` page
- [~] Integrations: API tokens + `POST /integrations/notes` (webhook/Zapier), `POST /integrations/email/:key` (email-to-note), HTML sanitized. `services/integrationService.ts`. **Still to do:** Integrations card in Profile, browser clipper extension (MV3, posts to `/integrations/notes` with token), calendar `.ics` from action items in `noteSummaryPanel`
- [~] i18n: `src/i18n/index.tsx` (provider, `useT`, en/es/hi). **Still to do:** add `I18nProvider` to `app/providers.tsx`, move strings into `messages/en.ts`, translate es/hi, language switcher

## Notes for the next session

- Work is on branch `feature/todo-roadmap`; merge to `master` when the remaining items are done.
- Everything type-checks: `apkh-api` (`npx tsc --noEmit -p tsconfig.json`) and `apkh-web` (`npx tsc --noEmit`). 
- New deps were installed: storage (express-rate-limit, pino, pino-http), API (archiver@7, turndown, marked, sanitize-html, nestjs-pino, socket.io, @nestjs/websockets), web (socket.io-client, diff), search venv (structlog — run `pip install -r requirements.txt`).
- New env vars are in each `.env.example` (ADMIN_EMAILS, PUBLIC_API_URL, INBOUND_EMAIL_DOMAIN, USER_QUOTA_MB, LOG_LEVEL…).
- Suggested next step: rewrite `apkh-web/src/app/(home)/layout.tsx` to use the hooks in `src/hooks/` (streaming, server filter, infinite scroll, offline, realtime), then build the remaining UI items above.
