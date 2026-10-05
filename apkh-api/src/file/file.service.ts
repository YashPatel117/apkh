import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import FormData from 'form-data';
import { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { fileStorageApi } from 'src/common/constant/endpoint';
import { correlationHeaders } from 'src/common/request-context';
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
          ...correlationHeaders(),
        },
      },
    );
    const res = await firstValueFrom(res$).catch((error: unknown) => {
      throw storageError(error);
    });

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

  // 📌 Get files for many notes in one query, keyed by noteId
  async getFilesForNotes(noteIds: string[]) {
    const records = await this.fileModel
      .find({ noteId: { $in: noteIds.map((id) => new Types.ObjectId(id)) } })
      .lean();
    return new Map(records.map((r) => [r.noteId.toString(), r.files]));
  }

  // 📌 Download one file
  async getFile(token: string, noteId: string, filename: string) {
    const response$ = this.httpService.get(
      `${fileStorageApi}files/${encodeURIComponent(noteId)}/${encodeURIComponent(filename)}`,
      {
        headers: { Authorization: token, ...correlationHeaders() },
        responseType: 'stream',
      },
    );
    const response = await firstValueFrom(response$);

    return response;
  }

  // 📌 Remove all files of a note
  async removeNoteFiles(token: string, noteId: string) {
    const noteObjectId = new Types.ObjectId(noteId);
    const noteFiles = await this.fileModel.findOne({ noteId: noteObjectId });

    if (!noteFiles?.files?.length) {
      await this.fileModel.deleteOne({ noteId: noteObjectId });
      return { message: 'No files attached to note' };
    }

    const res$ = this.httpService.delete(`${fileStorageApi}files/${noteId}`, {
      headers: { Authorization: token, ...correlationHeaders() },
    });
    await firstValueFrom(res$);

    await this.fileModel.deleteOne({ noteId: noteObjectId });
    return { message: 'Note folder deleted' };
  }

  // 📌 Remove selected files inside a note
  async removeSelectedFiles(token: string, noteId: string, files: string[]) {
    const res$ = this.httpService.delete(
      `${fileStorageApi}files/${noteId}/files`,
      {
        headers: { Authorization: token, ...correlationHeaders() },
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

/** Storage's own message (quota full, file too large, ...) with its status. */
function storageError(error: unknown): HttpException {
  if (isAxiosError(error) && error.response) {
    const data: unknown = error.response.data;
    const message =
      typeof data === 'string' && data.trim()
        ? data
        : 'The file could not be stored.';
    return new HttpException(message, error.response.status);
  }
  return new HttpException(
    'The file storage service is unavailable.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
