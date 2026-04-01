import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeChunk, KnowledgeChunkSchema } from 'src/common/schema/chunk';
import { SearchService } from './search.service';
import { UsersModule } from 'src/users/users.module';
import { Note, NoteSchema } from 'src/common/schema/note';
import { FileModule } from 'src/file/file.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
    FileModule,
    forwardRef(() => UsersModule),
  ],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
