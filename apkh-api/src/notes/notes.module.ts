import { Module } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Note, NoteSchema } from 'src/common/schema/note';
import { Summary, SummarySchema } from 'src/common/schema/summary';
import {
  NoteVersion,
  NoteVersionSchema,
} from 'src/common/schema/note-version';
import { FoldersModule } from 'src/folders/folders.module';
import { HttpModule } from '@nestjs/axios';
import { FileModule } from 'src/file/file.module';
import { SearchModule } from 'src/search/search.module';
import { IndexingModule } from 'src/indexing/indexing.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: Summary.name, schema: SummarySchema },
      { name: NoteVersion.name, schema: NoteVersionSchema },
    ]),
    FoldersModule,
    FileModule,
    SearchModule,
    IndexingModule,
  ],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
