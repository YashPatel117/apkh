import { Module } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Note, NoteSchema } from 'src/common/schema/note';
import { HttpModule } from '@nestjs/axios';
import { FileModule } from 'src/file/file.module';
import { SearchModule } from 'src/search/search.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    FileModule,
    SearchModule,
  ],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
