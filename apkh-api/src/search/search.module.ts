import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { SearchService } from './search.service';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
    ]),
    UsersModule,
  ],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
