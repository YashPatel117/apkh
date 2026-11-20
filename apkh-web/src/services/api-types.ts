/**
 * Request types generated from the API's OpenAPI description, so a renamed or
 * removed field in an apkh-api DTO breaks the web build instead of failing at
 * run time. Regenerate after changing a DTO:
 *
 *   cd apkh-api && npm run build && npm run openapi
 *   cd apkh-web && npm run api:types
 *
 * CI fails when apkh-api/openapi.json or api-schema.d.ts is out of date.
 */
import type { components } from "./api-schema";

type Schemas = components["schemas"];

/** The body an API route accepts, by its DTO name, e.g. `ApiBody<"LoginDto">`. */
export type ApiBody<Name extends keyof Schemas> = Schemas[Name];
