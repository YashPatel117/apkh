import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { HttpModule } from '@nestjs/axios';
import { NoteFiles, NoteFilesSchema } from 'src/common/schema/file';
import { MongooseModule } from '@nestjs/mongoose';
import { FileController } from './file.controller';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: NoteFiles.name, schema: NoteFilesSchema },
    ]),
  ],
  providers: [FileService],
  exports: [FileService],
  controllers: [FileController],
})
export class FileModule {}
