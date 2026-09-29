import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatMessage, ChatMessageSchema } from 'src/common/schema/chat-message';
import { ChatSession, ChatSessionSchema } from 'src/common/schema/chat-session';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { NoteFiles, NoteFilesSchema } from 'src/common/schema/file';
import { Note, NoteSchema } from 'src/common/schema/note';
import { Summary, SummarySchema } from 'src/common/schema/summary';
import { MigrationsService } from './migrations.service';

/** Startup data migrations. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: Summary.name, schema: SummarySchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: NoteFiles.name, schema: NoteFilesSchema },
    ]),
  ],
  providers: [MigrationsService],
})
export class DatabaseModule {}
