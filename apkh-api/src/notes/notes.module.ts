import { Module } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Note, NoteSchema } from 'src/common/schema/note';
import { Summary, SummarySchema } from 'src/common/schema/summary';
import { NoteVersion, NoteVersionSchema } from 'src/common/schema/note-version';
import { TrashedNote, TrashedNoteSchema } from 'src/common/schema/trashed-note';
import { FoldersModule } from 'src/folders/folders.module';
import { HttpModule } from '@nestjs/axios';
import { FileModule } from 'src/file/file.module';
import { SearchModule } from 'src/search/search.module';
import { IndexingModule } from 'src/indexing/indexing.module';
import { TrashService } from './trash.service';
import { NoteShare, NoteShareSchema } from 'src/common/schema/note-share';
import { ShareService } from './share.service';
import { SharedController } from './shared.controller';
import { ImportService } from './import/import.service';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: Summary.name, schema: SummarySchema },
      { name: NoteVersion.name, schema: NoteVersionSchema },
      { name: TrashedNote.name, schema: TrashedNoteSchema },
      { name: NoteShare.name, schema: NoteShareSchema },
    ]),
    FoldersModule,
    FileModule,
    SearchModule,
    IndexingModule,
  ],
  controllers: [NotesController, SharedController],
  providers: [NotesService, TrashService, ShareService, ImportService],
  exports: [NotesService],
})
export class NotesModule {}
