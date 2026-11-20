import type { DocumentBuilder } from '@nestjs/swagger';

/**
 * The OpenAPI document's header, shared by the live docs (/api, main.ts) and
 * the exported openapi.json (scripts/export-openapi.mjs) so the two match.
 */
export function swaggerConfig(builder: DocumentBuilder) {
  return builder
    .setTitle('APKH API')
    .setDescription(
      'AI-Powered Personal Knowledge Hub: notes, AI search, chat, files and integrations.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}
