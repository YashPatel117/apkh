/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Note, NoteDocument } from 'src/common/schema/note';
import { Summary, SummaryDocument } from 'src/common/schema/summary';
import { Model, Types } from 'mongoose';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { FileService } from 'src/file/file.service';
import { NoteResponse } from './dto/response.dto';
import { NoteSummaryResponse } from './dto/summary-response.dto';
import { SearchService } from 'src/search/search.service';
import { resolveNoteMetadata } from './utils/note-metadata';

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(Summary.name) private summaryModel: Model<SummaryDocument>,
    private readonly fileService: FileService,
    private readonly searchService: SearchService,
  ) { }

  /** CREATE */
  async create(
    token: string,
    userId: string,
    createNoteDto: CreateNoteDto,
    files: Express.Multer.File[],
  ) {
    try {
      const existingCategories = await this.noteModel.distinct('category', { userId });
      const resolvedMetadata = resolveNoteMetadata({
        title: createNoteDto.title,
        category: createNoteDto.category,
        content: createNoteDto.content,
        existingCategories,
      });
      const note = new this.noteModel({
        ...createNoteDto,
        ...resolvedMetadata,
        userId,
      });
      await note.save();
      const result: NoteResponse = {
        id: note._id as string,
        title: note.title,
        content: note.content,
        category: note.category,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        files: [],
      };
      if (files?.length) {
        const notefiles = await this.fileService.upload(
          token,
          note._id as string,
          files,
        );
        result.files = notefiles.files;
      }

      // Trigger AI ingestion (fire-and-forget)
      this.searchService.triggerIngestion(
        token,
        note._id as string,
        userId,
        note.title,
        note.content,
        result.files,
      );

      return new ApiResponseDto<NoteResponse>().ok(result);
    } catch (error: unknown) {
      throw new HttpException(error as string, HttpStatus.BAD_REQUEST);
    }
  }

  /** READ ALL */
  async findAll(userId: string) {
    try {
      const notes = await this.noteModel.find({ userId }).exec();
      const result: NoteResponse[] = [];
      for (const note of notes) {
        const noteFiles = await this.fileService.getNoteFiles(
          note._id as string,
        );
        result.push({
          id: note._id as string,
          title: note.title,
          content: note.content,
          category: note.category,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          files: noteFiles?.files || [],
        });
      }
      return new ApiResponseDto<NoteResponse[]>().ok(result);
    } catch (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }
  }

  /** READ ONE */
  async findOne(userId: string, _id: string) {
    try {
      const note = await this.noteModel.findOne({ userId, _id }).exec();
      if (!note) {
        throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
      }
      const noteFiles = await this.fileService.getNoteFiles(note._id as string);
      return new ApiResponseDto<NoteResponse>().ok({
        id: note._id as string,
        title: note.title,
        content: note.content,
        category: note.category,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        files: noteFiles?.files || [],
      });
    } catch (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }
  }

  /** UPDATE */
  async update(
    token: string,
    userId: string,
    _id: string,
    updateNoteDto: UpdateNoteDto,
    files: Express.Multer.File[],
  ) {
    const note = await this.noteModel.findOne({ userId, _id });
    if (!note) {
      throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
    }

    try {
      const existingCategories = await this.noteModel.distinct('category', { userId });
      const nextContent = updateNoteDto.content ?? note.content;
      const nextTitle = updateNoteDto.title === undefined ? note.title : updateNoteDto.title;
      const nextCategory =
        updateNoteDto.category === undefined ? note.category : updateNoteDto.category;
      const resolvedMetadata = resolveNoteMetadata({
        title: nextTitle,
        category: nextCategory,
        content: nextContent,
        existingCategories,
      });

      // Update note fields
      note.title = resolvedMetadata.title;
      note.content = nextContent;
      note.category = resolvedMetadata.category;

      // Remove files if requested
      if (updateNoteDto.removedFiles?.length) {
        await this.fileService.removeSelectedFiles(
          token,
          note._id as string,
          updateNoteDto.removedFiles
            ? updateNoteDto.removedFiles.split(',')
            : [],
        );
      }

      await note.save();
      const result: NoteResponse = {
        id: note._id as string,
        title: note.title,
        content: note.content,
        category: note.category,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        files: [],
      };
      // Upload new files if provided
      if (files?.length) {
        const fileNames = await this.fileService.upload(token, _id, files);
        result.files = fileNames.files;
      }

      // Get all current files for re-indexing
      const currentFiles = await this.fileService.getNoteFiles(_id);
      const allFiles = currentFiles?.files || result.files;
      result.files = allFiles;

      await this.clearSummaryCache(_id, userId);

      // Trigger AI re-ingestion (fire-and-forget)
      this.searchService.triggerIngestion(
        token,
        _id,
        userId,
        note.title,
        note.content,
        allFiles,
      );

      return new ApiResponseDto<NoteResponse>().ok(result);
    } catch (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }
  }

  /** DELETE */
  async remove(token: string, userId: string, _id: string) {
    try {
      const note = await this.noteModel.findOneAndDelete({ userId, _id });
      if (!note) {
        throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
      }

      // Delete related files
      await this.fileService.removeNoteFiles(token, _id);

      // Delete AI chunks
      await this.searchService.deleteChunks(_id);

      // Delete cached summaries
      await this.clearSummaryCache(_id, userId);

      return new ApiResponseDto<NoteDocument>().ok(note);
    } catch (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }
  }

  async getLastUpdated(userId: string) {
    const latestNote = await this.noteModel
      .findOne({ userId })
      .sort({ updatedAt: -1 })
      .select('updatedAt')
      .lean();

    return latestNote?.updatedAt || null;
  }

  async searchNotes(userId: string, q: string) {
    const notes = await this.noteModel.find({ userId, $text: { $search: q } });
    return notes;
  }

  async summarize(token: string, userId: string, _id: string) {
    try {
      const note = await this.noteModel.findOne({ userId, _id }).exec();
      if (!note) {
        throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
      }

      const noteFiles = await this.fileService.getNoteFiles(note._id as string);
      const attachedFiles = noteFiles?.files || [];
      const cachedSummary = await this.summaryModel
        .findOne({
          noteId: new Types.ObjectId(_id),
          userId: new Types.ObjectId(userId),
        })
        .exec();

      if (cachedSummary?.summary?.trim()) {
        return new ApiResponseDto<NoteSummaryResponse>().ok({
          noteId: _id,
          summary: cachedSummary.summary,
          cached: true,
          model: cachedSummary.summaryModel ?? null,
          generatedAt: cachedSummary.updatedAt ?? cachedSummary.createdAt ?? null,
        });
      }

      const generatedSummary = await this.searchService.generateNoteSummary(
        token,
        userId,
        note,
        attachedFiles,
      );

      let generatedAt: Date | null = null;
      let model = generatedSummary.model;

      if (generatedSummary.cacheable && generatedSummary.summary) {
        const summaryDoc = cachedSummary ?? new this.summaryModel();
        summaryDoc.noteId = new Types.ObjectId(_id);
        summaryDoc.userId = new Types.ObjectId(userId);
        summaryDoc.summary = generatedSummary.summary;
        summaryDoc.summaryModel = generatedSummary.model ?? undefined;
        await summaryDoc.save();
        generatedAt = summaryDoc.updatedAt ?? summaryDoc.createdAt ?? null;
        model = summaryDoc.summaryModel ?? null;
      }

      return new ApiResponseDto<NoteSummaryResponse>().ok({
        noteId: _id,
        summary: generatedSummary.summary,
        cached: false,
        model,
        generatedAt,
      });
    } catch (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }
  }

  private async clearSummaryCache(noteId: string, userId: string) {
    await this.summaryModel.deleteMany({
      noteId: new Types.ObjectId(noteId),
      userId: new Types.ObjectId(userId),
    });
  }
}
