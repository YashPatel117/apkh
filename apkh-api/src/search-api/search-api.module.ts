import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SearchApiClient } from './search-api.client';

/** HTTP access to the apkh-search service (extraction, embeddings, LLM calls). */
@Module({
  imports: [HttpModule],
  providers: [SearchApiClient],
  exports: [SearchApiClient],
})
export class SearchApiModule {}
