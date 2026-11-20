/**
 * Writes the API's OpenAPI description to openapi.json, without a database:
 * Nest's preview mode builds the module graph but instantiates nothing, so no
 * connection is opened. Run after `npm run build` (the Swagger plugin adds the
 * DTO metadata at build time):
 *
 *   npm run build && npm run openapi
 *
 * apkh-web generates its request/response types from the file
 * (`npm run api:types` there), and CI fails when the committed file is stale.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Modules read these while loading; preview mode never uses them.
process.env.MONGODB_URI ??= 'mongodb://preview.invalid/apkh';
process.env.JWT_SECRET ??= 'openapi-preview-only';
process.env.ENCRYPTION_SECRET ??= 'openapi-preview-only-openapi-preview-only';
process.env.INDEX_WORKER = 'off';
process.env.RUN_MIGRATIONS = 'off';

const { NestFactory } = require('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require(resolve(here, '../dist/app.module.js'));
const { swaggerConfig } = require(resolve(here, '../dist/common/openapi.js'));

const app = await NestFactory.create(AppModule, {
  preview: true,
  abortOnError: false,
  logger: false,
});
const document = SwaggerModule.createDocument(app, swaggerConfig(new DocumentBuilder()));
const out = resolve(here, '../openapi.json');
writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
await app.close();
console.log(`Wrote ${Object.keys(document.paths).length} paths to ${out}`);
