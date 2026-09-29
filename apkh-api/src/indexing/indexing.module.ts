import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatMessage, ChatMessageSchema } from 'src/common/schema/chat-message';
import { ChatSession, ChatSessionSchema } from 'src/common/schema/chat-session';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { IndexJob, IndexJobSchema } from 'src/common/schema/index-job';
import { Note, NoteSchema } from 'src/common/schema/note';
import { FileModule } from 'src/file/file.module';
import { SearchApiModule } from 'src/search-api/search-api.module';
import { UsersModule } from 'src/users/users.module';
import { ChatIndexerService } from './chat-indexer.service';
import { ChunkStoreService } from './chunk-store.service';
import { IndexQueueService } from './index-queue.service';
import { IndexWorkerService } from './index-worker.service';
import { IndexingService } from './indexing.service';
import { NoteIndexerService } from './note-indexer.service';
import { ServiceTokenService } from './service-token.service';

/**
 * Background indexing of notes (text + attachments) and chat transcripts into
 * searchable chunks: a queue in MongoDB, a worker, and incremental indexers.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IndexJob.name, schema: IndexJobSchema },
      { name: Note.name, schema: NoteSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    FileModule,
    SearchApiModule,
    forwardRef(() => UsersModule),
  ],
  providers: [
    IndexQueueService,
    ChunkStoreService,
    NoteIndexerService,
    ChatIndexerService,
    IndexWorkerService,
    ServiceTokenService,
    IndexingService,
  ],
  exports: [IndexingService],
})
export class IndexingModule {}
