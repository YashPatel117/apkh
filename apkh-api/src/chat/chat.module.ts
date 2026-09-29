import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from 'src/users/users.module';
import { SearchModule } from 'src/search/search.module';
import { ChatSession, ChatSessionSchema } from 'src/common/schema/chat-session';
import { ChatMessage, ChatMessageSchema } from 'src/common/schema/chat-message';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
    ]),
    HttpModule,
    UsersModule,
    SearchModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
