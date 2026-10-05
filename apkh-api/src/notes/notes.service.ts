import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Note, NoteDocument } from 'src/common/schema/note';
import {
  NoteVersion,
  NoteVersionDocument,
} from 'src/common/schema/note-version';
import {
  Summary,
  SummaryDocument,
  SummaryMode,
} from 'src/common/schema/summary';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import archiver from 'archiver';
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { FileService } from 'src/file/file.service';
import { NoteResponse } from './dto/response.dto';
import { NoteSummaryResponse } from './dto/summary-response.dto';
import { SearchService } from 'src/search/search.service';
import { resolveNoteMetadata } from './utils/note-metadata';
import {
  displayFileName,
  noteToMarkdown,
  safeFileName,
} from './utils/markdown';
import { errorMessage, toHttpException } from 'src/common/utils/http-error';
import { IndexingService } from 'src/indexing/indexing.service';
import { FoldersService } from 'src/folders/folders.service';
import { RealtimeService } from 'src/realtime/realtime.service';

export interface NotesPageQuery {
  limit: number;
  cursor?: string;
  /** Words to look for in the title, category and text */
  q?: string;
  category?: string;
  /** A folder id, or "root" for notes outside any folder */
  folderId?: string;
}

export interface NotesPage {
  notes: NoteResponse[];
  /** Pass back as `cursor` for the next page; null on the last page */
  nextCursor: string | null;
  /** Notes matching the filters, across all pages */
  total: number;
}

// Versions kept per note; the oldest go first.
const MAX_VERSIONS_PER_NOTE = 50;

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(Summary.name) private summaryModel: Model<SummaryDocument>,
    @InjectModel(NoteVersion.name)
    private versionModel: Model<NoteVersionDocument>,
    private readonly fileService: FileService,
    private readonly searchService: SearchService,
    private readonly indexing: IndexingService,
    private readonly folders: FoldersService,
    private readonly realtime: RealtimeService,
  ) {}

  /** CREATE */
  async create(
    token: string,
    userId: string,
    createNoteDto: CreateNoteDto,
    files: Express.Multer.File[],
  ) {
    try {
      const existingCategories = await this.noteModel.distinct('category', {
        userId,
      });
      const resolvedMetadata = resolveNoteMetadata({
        title: createNoteDto.title,
        category: createNoteDto.category,
        content: createNoteDto.content,
        existingCategories,
      });
      const folderId = createNoteDto.folderId
        ? (await this.folders.require(userId, createNoteDto.folderId))._id
        : null;
      const note = new this.noteModel({
        ...createNoteDto,
        ...resolvedMetadata,
        folderId,
        userId,
      });
      await note.save();
      const result = toNoteResponse(note, []);
      if (files?.length) {
        // A refused upload (too large, storage full) undoes the note, so
        // trying again doesn't leave a copy behind.
        const notefiles = await this.fileService
          .upload(token, note._id as string, files)
          .catch(async (error: unknown) => {
            await this.noteModel.deleteOne({ _id: note._id });
            throw error;
          });
        result.files = notefiles.files;
      }

      // Index in the background; the queue retries until it succeeds
      this.queueIndexing(userId, String(note._id));
      this.realtime.emit(userId, 'note:saved', result);

      return new ApiResponseDto<NoteResponse>().ok(result);
    } catch (error: unknown) {
      throw toHttpException(error);
    }
  }

  /** READ ALL (every note at once; older clients) */
  async findAll(userId: string) {
    try {
      const notes = await this.noteModel.find({ userId }).exec();
      const filesByNote = await this.fileService.getFilesForNotes(
        notes.map((note) => String(note._id)),
      );
      const result = notes.map((note) =>
        toNoteResponse(note, filesByNote.get(String(note._id)) ?? []),
      );
      return new ApiResponseDto<NoteResponse[]>().ok(result);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /**
   * A page of notes, newest change first, optionally filtered by words,
   * category or folder. The cursor is the last note's position, so pages
   * stay consistent while notes are added.
   */
  async findPage(userId: string, query: NotesPageQuery) {
    try {
      const filter: FilterQuery<NoteDocument> = {
        userId: new Types.ObjectId(userId),
      };
      const q = query.q?.trim();
      if (q) {
        // Substring match, like the search box always did; one pattern per word.
        filter.$and = q
          .split(/\s+/)
          .slice(0, 8)
          .map((word) => {
            const pattern = new RegExp(escapeRegExp(word), 'i');
            return {
              $or: [
                { title: pattern },
                { category: pattern },
                { contentPlain: pattern },
              ],
            };
          });
      }
      if (query.category) filter.category = query.category;
      if (query.folderId === 'root') filter.folderId = null;
      else if (query.folderId && isValidObjectId(query.folderId)) {
        filter.folderId = new Types.ObjectId(query.folderId);
      }

      const pageFilter: FilterQuery<NoteDocument> = { ...filter };
      const after = decodeCursor(query.cursor);
      if (after) {
        pageFilter.$or = [
          { updatedAt: { $lt: after.updatedAt } },
          { updatedAt: after.updatedAt, _id: { $lt: after.id } },
        ];
      }

      const [notes, total] = await Promise.all([
        this.noteModel
          .find(pageFilter)
          .sort({ updatedAt: -1, _id: -1 })
          .limit(query.limit + 1)
          .exec(),
        this.noteModel.countDocuments(filter).exec(),
      ]);
      const hasMore = notes.length > query.limit;
      const page = notes.slice(0, query.limit);
      const filesByNote = await this.fileService.getFilesForNotes(
        page.map((note) => String(note._id)),
      );
      const last = page[page.length - 1];
      return new ApiResponseDto<NotesPage>().ok({
        notes: page.map((note) =>
          toNoteResponse(note, filesByNote.get(String(note._id)) ?? []),
        ),
        nextCursor: hasMore && last ? encodeCursor(last) : null,
        total,
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Every category in use, with how many notes are in it. */
  async categories(userId: string) {
    const rows = await this.noteModel
      .aggregate<{ _id: string; count: number }>([
        { $match: { userId: new Types.ObjectId(userId) } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .exec();
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return new ApiResponseDto<{
      categories: { name: string; count: number }[];
      total: number;
    }>().ok({
      categories: rows
        .filter((row) => row._id?.trim())
        .map((row) => ({ name: row._id.trim(), count: row.count })),
      total,
    });
  }

  /** READ ONE */
  async findOne(userId: string, _id: string) {
    try {
      const note = await this.requireNote(userId, _id);
      const noteFiles = await this.fileService.getNoteFiles(note._id as string);
      return new ApiResponseDto<NoteResponse>().ok(
        toNoteResponse(note, noteFiles?.files || []),
      );
    } catch (error) {
      throw toHttpException(error);
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
    const note = await this.requireNote(userId, _id);

    try {
      const existingCategories = await this.noteModel.distinct('category', {
        userId,
      });
      const nextContent = updateNoteDto.content ?? note.content;
      const nextTitle =
        updateNoteDto.title === undefined ? note.title : updateNoteDto.title;
      const nextCategory =
        updateNoteDto.category === undefined
          ? note.category
          : updateNoteDto.category;
      const resolvedMetadata = resolveNoteMetadata({
        title: nextTitle,
        category: nextCategory,
        content: nextContent,
        existingCategories,
      });

      await this.snapshot(note, {
        title: resolvedMetadata.title,
        category: resolvedMetadata.category,
        content: nextContent,
      });

      // Update note fields
      note.title = resolvedMetadata.title;
      note.content = nextContent;
      note.category = resolvedMetadata.category;
      if (updateNoteDto.folderId !== undefined) {
        note.folderId = updateNoteDto.folderId
          ? ((await this.folders.require(userId, updateNoteDto.folderId))
              ._id as Types.ObjectId)
          : null;
      }

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
      const result = toNoteResponse(note, []);
      // Upload new files if provided
      if (files?.length) {
        const fileNames = await this.fileService.upload(token, _id, files);
        result.files = fileNames.files;
      }

      // Get all current files for re-indexing
      const currentFiles = await this.fileService.getNoteFiles(_id);
      result.files = currentFiles?.files || result.files;

      await this.clearSummaryCache(_id, userId);

      // Re-index in the background: only what changed is re-read and re-embedded
      this.queueIndexing(userId, _id);
      this.realtime.emit(userId, 'note:saved', result);

      return new ApiResponseDto<NoteResponse>().ok(result);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** File a note in a folder (null: take it out of every folder). */
  async move(userId: string, _id: string, folderId: string | null) {
    const note = await this.requireNote(userId, _id);
    note.folderId = folderId
      ? ((await this.folders.require(userId, folderId))._id as Types.ObjectId)
      : null;
    // Moving isn't an edit: the note keeps its place in "recently changed".
    await note.save({ timestamps: false });
    const files = await this.fileService.getNoteFiles(_id);
    const result = toNoteResponse(note, files?.files ?? []);
    this.realtime.emit(userId, 'note:saved', result);
    this.realtime.emit(userId, 'folders:changed');
    return new ApiResponseDto<NoteResponse>().ok(result);
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

      // Delete the note's search index
      await this.indexing.removeNote(_id);

      // Delete cached summaries and the edit history
      await Promise.all([
        this.clearSummaryCache(_id, userId),
        this.versionModel.deleteMany({ noteId: note._id }),
      ]);

      this.realtime.emit(userId, 'note:deleted', { id: _id });
      return new ApiResponseDto<NoteDocument>().ok(note);
    } catch (error) {
      throw toHttpException(error);
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

  // ── Version history ──────────────────────────────────────────────────────

  /** Earlier versions of a note, newest first (without their content). */
  async listVersions(userId: string, _id: string) {
    const note = await this.requireNote(userId, _id);
    const versions = await this.versionModel
      .find({ noteId: note._id })
      .sort({ savedAt: -1 })
      .select('title category savedAt createdAt content')
      .lean()
      .exec();
    return new ApiResponseDto().ok(
      versions.map((v) => ({
        id: String(v._id),
        title: v.title,
        category: v.category,
        savedAt: v.savedAt,
        replacedAt: v.createdAt,
        size: v.content.length,
      })),
    );
  }

  /** One earlier version, with its content. */
  async getVersion(userId: string, _id: string, versionId: string) {
    const version = await this.requireVersion(userId, _id, versionId);
    return new ApiResponseDto().ok({
      id: String(version._id),
      title: version.title,
      category: version.category,
      content: version.content,
      savedAt: version.savedAt,
      replacedAt: version.createdAt,
    });
  }

  /** Bring back an earlier version; the current one is kept in the history. */
  async restoreVersion(userId: string, _id: string, versionId: string) {
    const note = await this.requireNote(userId, _id);
    const version = await this.requireVersion(userId, _id, versionId);
    await this.snapshot(note, version);
    note.title = version.title;
    note.category = version.category || note.category;
    note.content = version.content;
    await note.save();
    await this.clearSummaryCache(_id, userId);
    this.queueIndexing(userId, _id);
    const files = await this.fileService.getNoteFiles(_id);
    const result = toNoteResponse(note, files?.files ?? []);
    this.realtime.emit(userId, 'note:saved', result);
    return new ApiResponseDto<NoteResponse>().ok(result);
  }

  /** Store the note as it is now, if `next` changes it. */
  private async snapshot(
    note: NoteDocument,
    next: { title: string; category: string; content: string },
  ) {
    if (
      note.title === next.title &&
      note.category === next.category &&
      note.content === next.content
    ) {
      return;
    }
    await this.versionModel.create({
      noteId: note._id,
      userId: note.userId,
      title: note.title,
      category: note.category,
      content: note.content,
      savedAt: note.updatedAt ?? new Date(),
    });
    const stale = await this.versionModel
      .find({ noteId: note._id })
      .sort({ savedAt: -1 })
      .skip(MAX_VERSIONS_PER_NOTE)
      .select('_id')
      .lean()
      .exec();
    if (stale.length) {
      await this.versionModel.deleteMany({
        _id: { $in: stale.map((v) => v._id) },
      });
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────

  /** One note as Markdown, or (`zip`) Markdown plus its attachments. */
  async exportNote(
    token: string,
    userId: string,
    _id: string,
    format: 'md' | 'zip',
    res: Response,
  ) {
    const note = await this.requireNote(userId, _id);
    const [files, paths] = await Promise.all([
      this.fileService.getNoteFiles(_id),
      note.folderId ? this.folders.paths(userId) : null,
    ]);
    const markdown = noteToMarkdown({
      ...note.toObject(),
      folderPath: note.folderId ? paths?.get(String(note.folderId)) : undefined,
    });
    const name = safeFileName(note.title);

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', attachment(`${name}.md`));
      res.send(markdown);
      return;
    }

    const archive = this.startZip(res, `${name}.zip`);
    archive.append(markdown, { name: `${name}.md` });
    await this.appendAttachments(
      archive,
      token,
      _id,
      files?.files ?? [],
      'attachments',
    );
    await archive.finalize();
  }

  /**
   * Every note as Markdown in a ZIP, in folders like the app's, with their
   * attachments, plus a JSON copy for re-importing. A backup the user owns.
   */
  async exportAll(token: string, userId: string, res: Response) {
    const [notes, paths] = await Promise.all([
      this.noteModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ updatedAt: -1 })
        .exec(),
      this.folders.paths(userId),
    ]);
    const filesByNote = await this.fileService.getFilesForNotes(
      notes.map((note) => String(note._id)),
    );

    const date = new Date().toISOString().slice(0, 10);
    const archive = this.startZip(res, `knowledge-hub-export-${date}.zip`);
    const used = new Set<string>();
    const manifest: unknown[] = [];

    for (const note of notes) {
      const folderPath = note.folderId
        ? paths.get(String(note.folderId))
        : undefined;
      const dir = folderPath
        ? folderPath.split(' / ').map((part) => safeFileName(part)).join('/')
        : '';
      // Two notes with one title get "Title (2)".
      let base = `${dir ? `${dir}/` : ''}${safeFileName(note.title)}`;
      for (let n = 2; used.has(base.toLowerCase()); n++) {
        base = `${dir ? `${dir}/` : ''}${safeFileName(note.title)} (${n})`;
      }
      used.add(base.toLowerCase());

      const noteFiles = filesByNote.get(String(note._id)) ?? [];
      // Attachments sit next to the note, under "<note> attachments/".
      const markdown = noteToMarkdown({
        ...note.toObject(),
        folderPath,
      }).replace(
        /\]\(attachments\//g,
        `](${encodeURI(`${base.split('/').pop()} attachments/`)}`,
      );
      archive.append(markdown, { name: `notes/${base}.md` });
      await this.appendAttachments(
        archive,
        token,
        String(note._id),
        noteFiles,
        `notes/${base} attachments`,
      );
      manifest.push({
        id: String(note._id),
        title: note.title,
        category: note.category,
        folder: folderPath ?? null,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        files: noteFiles.map(displayFileName),
      });
    }

    archive.append(JSON.stringify({ exportedAt: new Date(), notes: manifest }, null, 2), {
      name: 'notes.json',
    });
    await archive.finalize();
  }

  private startZip(res: Response, fileName: string) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', attachment(fileName));
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) =>
      this.logger.warn(`Export warning: ${errorMessage(err)}`),
    );
    archive.on('error', (err) => {
      this.logger.error(`Export failed: ${errorMessage(err)}`);
      res.destroy(err);
    });
    archive.pipe(res);
    return archive;
  }

  /** Streams each attachment from storage into the ZIP; missing ones are skipped. */
  private async appendAttachments(
    archive: archiver.Archiver,
    token: string,
    noteId: string,
    files: string[],
    folder: string,
  ) {
    for (const file of files) {
      try {
        const response = await this.fileService.getFile(token, noteId, file);
        const stream = response.data as Readable;
        archive.append(stream, { name: `${folder}/${file}` });
        // One attachment at a time keeps memory flat for large exports.
        await new Promise<void>((resolve, reject) => {
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      } catch (error) {
        this.logger.warn(
          `Export skipped ${file} of note ${noteId}: ${errorMessage(error)}`,
        );
      }
    }
  }

  // ── AI ───────────────────────────────────────────────────────────────────

  async summarize(
    token: string,
    userId: string,
    _id: string,
    mode: SummaryMode = 'brief',
  ) {
    try {
      const note = await this.requireNote(userId, _id);

      const noteFiles = await this.fileService.getNoteFiles(note._id as string);
      const attachedFiles = noteFiles?.files || [];
      // One cached summary per mode; editing the note clears them all.
      const cacheKey = {
        noteId: new Types.ObjectId(_id),
        userId: new Types.ObjectId(userId),
        mode,
      };
      const cachedSummary = await this.summaryModel.findOne(cacheKey).exec();
      const cacheHit =
        mode === 'actions'
          ? Boolean(cachedSummary?.actions)
          : Boolean(cachedSummary?.summary?.trim());

      if (cachedSummary && cacheHit) {
        return new ApiResponseDto<NoteSummaryResponse>().ok({
          noteId: _id,
          mode,
          summary: cachedSummary.summary,
          actions: cachedSummary.actions ?? null,
          cached: true,
          model: cachedSummary.summaryModel ?? null,
          generatedAt:
            cachedSummary.updatedAt ?? cachedSummary.createdAt ?? null,
        });
      }

      const generated = await this.searchService.generateNoteSummary(
        token,
        userId,
        note,
        attachedFiles,
        mode,
      );

      let generatedAt: Date | null = null;
      if (generated.cacheable) {
        const saved = await this.summaryModel.findOneAndUpdate(
          cacheKey,
          {
            $set: {
              summary: generated.summary,
              actions: generated.actions ?? undefined,
              summaryModel: generated.model ?? undefined,
            },
          },
          { upsert: true, new: true },
        );
        generatedAt = saved?.updatedAt ?? null;
      }

      return new ApiResponseDto<NoteSummaryResponse>().ok({
        noteId: _id,
        mode,
        summary: generated.summary,
        actions: generated.actions,
        cached: false,
        model: generated.model,
        generatedAt,
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Notes related to (or near-duplicates of) a note. */
  async similar(userId: string, _id: string) {
    await this.requireNote(userId, _id);
    return this.searchService.similarNotes(userId, _id);
  }

  /** Queue a note for re-indexing (e.g. to retry an attachment). */
  async reindex(userId: string, _id: string, force = false) {
    await this.requireNote(userId, _id);
    await this.indexing.enqueueNote(userId, _id, { force });
    return new ApiResponseDto<{ queued: boolean }>().ok({ queued: true });
  }

  private async requireNote(userId: string, _id: string) {
    const note = isValidObjectId(_id)
      ? await this.noteModel.findOne({ userId, _id }).exec()
      : null;
    if (!note) {
      throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
    }
    return note;
  }

  private async requireVersion(userId: string, _id: string, versionId: string) {
    const version = isValidObjectId(versionId)
      ? await this.versionModel
          .findOne({
            _id: versionId,
            noteId: new Types.ObjectId(_id),
            userId: new Types.ObjectId(userId),
          })
          .lean()
          .exec()
      : null;
    if (!version) {
      throw new HttpException('Version not found', HttpStatus.NOT_FOUND);
    }
    return version;
  }

  private queueIndexing(userId: string, noteId: string) {
    // If this fails the note is still saved; the next reconcile queues it.
    this.indexing.enqueueNote(userId, noteId).catch((err) => {
      this.logger.error(
        `Queueing note ${noteId} for indexing failed: ${errorMessage(err)}`,
      );
    });
  }

  private async clearSummaryCache(noteId: string, userId: string) {
    await this.summaryModel.deleteMany({
      noteId: new Types.ObjectId(noteId),
      userId: new Types.ObjectId(userId),
    });
  }
}

function toNoteResponse(note: NoteDocument, files: string[]): NoteResponse {
  return {
    id: note._id as string,
    title: note.title,
    content: note.content,
    category: note.category,
    folderId: note.folderId ? String(note.folderId) : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    files,
  };
}

function encodeCursor(note: NoteDocument): string {
  return Buffer.from(
    `${new Date(note.updatedAt).toISOString()}|${String(note._id)}`,
  ).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
): { updatedAt: Date; id: Types.ObjectId } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const updatedAt = new Date(iso);
  if (Number.isNaN(updatedAt.getTime()) || !isValidObjectId(id)) {
    throw new HttpException('Invalid cursor', HttpStatus.BAD_REQUEST);
  }
  return { updatedAt, id: new Types.ObjectId(id) };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Content-Disposition for a download, with a UTF-8 name and an ASCII fallback. */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
