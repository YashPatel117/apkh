import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { Note, NoteSchema } from 'src/common/schema/note';
import { IndexingModule } from 'src/indexing/indexing.module';
import { SearchApiModule } from 'src/search-api/search-api.module';
import { UsersModule } from 'src/users/users.module';
import { RetrievalService } from './retrieval.service';
import { QueryRewriteService } from './query-rewrite.service';
import { SearchService } from './search.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
    SearchApiModule,
    IndexingModule,
    forwardRef(() => UsersModule),
  ],
  providers: [SearchService, RetrievalService, QueryRewriteService],
  exports: [SearchService, RetrievalService, QueryRewriteService],
})
export class SearchModule {}
