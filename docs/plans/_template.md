# Feature: <name>

Roadmap item: <section and line from ROADMAP.md, or "new">

## Goal
One paragraph: what the user can do after this ships.

## Contract changes
- **API routes (apkh-api)**: method · path · guard · `@RateLimit` · request DTO · response shape
- **DTOs**: class name, fields with types and validators (these become `openapi.json` → `ApiBody<"…">`)
- **Mongo**: new schemas / fields in `src/common/schema/*`, migrations in `src/database/migrations.service.ts`
- **apkh-search routes**: method · path · Pydantic request/response models
- **Storage / MCP / integrations**: routes, tool names, token scopes
- or "none"

## Shared names (the cross-agent contract)
Agents must use these exactly.

```ts
// api ↔ web-data — request DTOs and response shapes
// class CreateThingDto { name: string; folderId?: string }      → ApiBody<"CreateThingDto">
// interface ThingResponse { id: string; name: string; createdAt: string }

// web-data → web-ui — services, hooks, store
// services/thingService.ts: createThing(body: ApiBody<"CreateThingDto">): Promise<ThingResponse>
// hooks/useThings.ts: useThings(): { things: ThingResponse[]; loading: boolean; error: string | null; create(...): Promise<void> }
// store/slices/thingSlice.ts: actions setThings, selectors selectThings

// web-ui — i18n key prefix: "thing.*" (en, es, hi)
```

```py
# api ↔ search — apkh-search/routes/<x>.py  ↔  apkh-api/src/search-api/search-api.client.ts
# POST /area/action  { "api_key": str, "model": str, "text": str } → { "result": str, "tokens": int }
```

## Tasks per agent
### api
- …

### web-data
- …

### web-ui
- …

### search
- …

### satellites
- …

(Delete agents with nothing to do. Reviewers run after integration.)

## Wiring (orchestrator)
- `apkh-api/src/app.module.ts` imports · `apkh-search/main.py` `include_router` · `apkh-web/src/app/providers.tsx` / `layout.tsx`
- Packages · env vars (+ `scripts/init-env.mjs`, `deploy/`) · `scripts/codegen.ps1`
- `ARCHITECTURE.md` sections to update · `ROADMAP.md` item to tick

## Tests
No test suites exist yet (ROADMAP 1.2). List the manual checks against the live stack, and the quick checks each agent must pass.

## Open questions
