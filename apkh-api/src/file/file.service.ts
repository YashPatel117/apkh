import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import FormData from 'form-data';
import { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { fileStorageApi } from 'src/common/constant/endpoint';
import { NoteFileDocument, NoteFiles } from 'src/common/schema/file';

@Injectable()
export class FileService {
  constructor(
    private readonly httpService: HttpService,
    @InjectModel(NoteFiles.name) private fileModel: Model<NoteFileDocument>,
  ) {}

  // 📌 Upload files for a note
  async upload(token: string, noteId: string, files: Express.Multer.File[]) {
    const form = new FormData();
    files.forEach((f) => {
      form.append('files', f.buffer, f.originalname);
    });

    const res$ = this.httpService.post<string[]>(
      `${fileStorageApi}upload/${noteId}`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: token,
        },
      },
    );
    const res = await firstValueFrom(res$);

    // upsert db record
    const noteObjectId = new Types.ObjectId(noteId);
    const noteFiles = await this.fileModel.findOneAndUpdate(
      { noteId: noteObjectId },
      { $push: { files: { $each: res.data } } },
      { upsert: true, new: true },
    );

    return noteFiles;
  }

  // 📌 Get all files for one note
  async getNoteFiles(noteId: string) {
    return await this.fileModel.findOne({ noteId: new Types.ObjectId(noteId) });
  }

  // 📌 Download one file
  async getFile(token: string, noteId: string, filename: string) {
    const response$ = this.httpService.post(
      `${fileStorageApi}files`,
      { noteId, files: filename },
      {
        headers: { Authorization: token },
        responseType: 'stream',
      },
    );
    const response = await firstValueFrom(response$);

    return response;
  }

  // 📌 Remove all files of a note
  async removeNoteFiles(token: string, noteId: string) {
    const res$ = this.httpService.delete(`${fileStorageApi}files/${noteId}`, {
      headers: { Authorization: token },
    });
    await firstValueFrom(res$);

    await this.fileModel.deleteOne({ noteId: new Types.ObjectId(noteId) });
    return { message: 'Note folder deleted' };
  }

  // 📌 Remove selected files inside a note
  async removeSelectedFiles(token: string, noteId: string, files: string[]) {
    const res$ = this.httpService.delete(
      `${fileStorageApi}files/${noteId}/files`,
      {
        headers: { Authorization: token },
        data: { filenames: files },
      },
    );
    await firstValueFrom(res$);

    const noteFiles = await this.fileModel.findOne({
      noteId: new Types.ObjectId(noteId),
    });
    if (!noteFiles) return;

    noteFiles.files = noteFiles.files.filter((f) => !files.includes(f));
    return await noteFiles.save();
  }
}
