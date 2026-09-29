import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from 'src/users/users.module';
import { SearchModule } from 'src/search/search.module';
import { IndexingModule } from 'src/indexing/indexing.module';
import { SearchApiModule } from 'src/search-api/search-api.module';
import { ChatSession, ChatSessionSchema } from 'src/common/schema/chat-session';
import { ChatMessage, ChatMessageSchema } from 'src/common/schema/chat-message';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    UsersModule,
    SearchModule,
    IndexingModule,
    SearchApiModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
