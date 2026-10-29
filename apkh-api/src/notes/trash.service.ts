import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Note, NoteDocument } from 'src/common/schema/note';
import {
  NoteVersion,
  NoteVersionDocument,
} from 'src/common/schema/note-version';
import { Summary, SummaryDocument } from 'src/common/schema/summary';
import {
  TrashedNote,
  TrashedNoteDocument,
} from 'src/common/schema/trashed-note';
import { htmlToPlainText } from 'src/common/utils/html';
import { errorMessage } from 'src/common/utils/http-error';
import { FileService } from 'src/file/file.service';
import { FoldersService } from 'src/folders/folders.service';
import { IndexingService } from 'src/indexing/indexing.service';
import { ServiceTokenService } from 'src/indexing/service-token.service';
import { RealtimeService } from 'src/realtime/realtime.service';
import { ShareService } from './share.service';

const DEFAULT_RETENTION_DAYS = 30;
// How often expired notes are purged
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_PURGE_DELAY_MS = 60 * 1000;
// Characters of text shown for each note in the trash list
const SNIPPET_CHARS = 200;

export interface TrashedNoteView {
  id: string;
  title: string;
  category: string;
  snippet: string;
  files: string[];
  deletedAt: Date;
  /** When the note is deleted for good */
  purgeAt: Date;
}

export function trashRetentionDays(): number {
  const days = Number(process.env.TRASH_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

/**
 * Deleted notes wait in the trash before they are gone for good. Trashing
 * takes a note out of every list and search (it leaves the `notes`
 * collection and the index); its attachments and history stay until purge.
 */
@Injectable()
export class TrashService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrashService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(TrashedNote.name)
    private trashModel: Model<TrashedNoteDocument>,
    @InjectModel(NoteVersion.name)
    private versionModel: Model<NoteVersionDocument>,
    @InjectModel(Summary.name) private summaryModel: Model<SummaryDocument>,
    private readonly fileService: FileService,
    private readonly folders: FoldersService,
    private readonly indexing: IndexingService,
    private readonly serviceTokens: ServiceTokenService,
    private readonly realtime: RealtimeService,
    private readonly shares: ShareService,
  ) {}

  onApplicationBootstrap() {
    const purge = () => {
      this.purgeExpired().catch((err) =>
        this.logger.error(`Purging the trash failed: ${errorMessage(err)}`),
      );
    };
    this.timers.push(setTimeout(purge, FIRST_PURGE_DELAY_MS));
    this.timers.push(setInterval(purge, PURGE_INTERVAL_MS));
    this.timers.forEach((timer) => timer.unref());
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  /** Move a note to the trash. */
  async trash(userId: string, noteId: string) {
    const note = isValidObjectId(noteId)
      ? await this.noteModel.findOne({ userId, _id: noteId }).lean().exec()
      : null;
    if (!note) {
      throw new HttpException('Note not found', HttpStatus.BAD_REQUEST);
    }
    await this.trashModel.create({
      noteId: note._id,
      userId: note.userId,
      title: note.title,
      content: note.content,
      category: note.category ?? '',
      tags: note.tags ?? [],
      folderId: note.folderId ?? null,
      noteCreatedAt: note.createdAt,
      noteUpdatedAt: note.updatedAt,
      deletedAt: new Date(),
    });
    await this.noteModel.deleteOne({ _id: note._id });
    await Promise.all([
      this.indexing.removeNote(noteId),
      this.summaryModel.deleteMany({ noteId: note._id }),
    ]);
    this.realtime.emit(userId, 'note:deleted', { id: noteId });
    this.realtime.emit(userId, 'trash:changed');
  }

  async list(userId: string): Promise<TrashedNoteView[]> {
    const trashed = await this.trashModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ deletedAt: -1 })
      .lean()
      .exec();
    const files = await this.fileService.getFilesForNotes(
      trashed.map((t) => String(t.noteId)),
    );
    const retentionMs = trashRetentionDays() * 24 * 3_600_000;
    return trashed.map((t) => ({
      id: String(t.noteId),
      title: t.title,
      category: t.category,
      snippet: htmlToPlainText(t.content).slice(0, SNIPPET_CHARS),
      files: files.get(String(t.noteId)) ?? [],
      deletedAt: t.deletedAt,
      purgeAt: new Date(t.deletedAt.getTime() + retentionMs),
    }));
  }

  /** Put a note back where it was (the top level if its folder is gone) and index it again. */
  async restore(userId: string, noteId: string) {
    const trashed = await this.requireTrashed(userId, noteId);
    const folderId = trashed.folderId
      ? await this.folders
          .require(userId, String(trashed.folderId))
          .then((folder) => folder._id as Types.ObjectId)
          .catch(() => null)
      : null;

    const note = new this.noteModel({
      _id: trashed.noteId,
      userId: trashed.userId,
      title: trashed.title,
      content: trashed.content,
      category: trashed.category || 'General',
      tags: trashed.tags ?? [],
      folderId,
      createdAt: trashed.noteCreatedAt,
      updatedAt: trashed.noteUpdatedAt,
    });
    await note.save({ timestamps: false });
    await this.trashModel.deleteOne({ _id: trashed._id });

    await this.indexing.enqueueNote(userId, noteId).catch((err) => {
      // The note is back either way; the next reconcile queues it.
      this.logger.error(
        `Queueing restored note ${noteId} failed: ${errorMessage(err)}`,
      );
    });
    const files = await this.fileService.getNoteFiles(noteId);
    const restored = {
      id: noteId,
      title: note.title,
      content: note.content,
      category: note.category,
      tags: note.tags ?? [],
      folderId: folderId ? String(folderId) : null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      files: files?.files ?? [],
    };
    this.realtime.emit(userId, 'note:saved', restored);
    this.realtime.emit(userId, 'folders:changed');
    this.realtime.emit(userId, 'trash:changed');
    return restored;
  }

  /** Delete one trashed note for good: the note, its files and its history. */
  async purge(token: string, userId: string, noteId: string) {
    const trashed = await this.requireTrashed(userId, noteId);
    await this.purgeOne(token, trashed);
    this.realtime.emit(userId, 'trash:changed');
  }

  /** Delete everything in a user's trash for good. */
  async empty(token: string, userId: string) {
    const trashed = await this.trashModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    for (const note of trashed) await this.purgeOne(token, note);
    this.realtime.emit(userId, 'trash:changed');
    return { deleted: trashed.length };
  }

  /** Notes past the retention period, purged on the users' behalf. */
  async purgeExpired() {
    const cutoff = new Date(Date.now() - trashRetentionDays() * 24 * 3_600_000);
    const expired = await this.trashModel
      .find({ deletedAt: { $lt: cutoff } })
      .lean()
      .exec();
    for (const note of expired) {
      const userId = String(note.userId);
      await this.purgeOne(this.serviceTokens.forUser(userId), note).catch(
        (err) =>
          this.logger.error(
            `Purging note ${String(note.noteId)} failed: ${errorMessage(err)}`,
          ),
      );
    }
    if (expired.length) {
      this.logger.log(`Purged ${expired.length} notes from the trash`);
    }
  }

  private async purgeOne(token: string, trashed: TrashedNote) {
    const noteId = String(trashed.noteId);
    // Files first: if storage is down the note stays in the trash for another try.
    await this.fileService.removeNoteFiles(token, noteId);
    await Promise.all([
      this.versionModel.deleteMany({ noteId: trashed.noteId }),
      this.trashModel.deleteOne({ noteId: trashed.noteId }),
      this.shares.removeForNote(trashed.noteId),
    ]);
  }

  private async requireTrashed(userId: string, noteId: string) {
    const trashed = isValidObjectId(noteId)
      ? await this.trashModel
          .findOne({
            userId: new Types.ObjectId(userId),
            noteId: new Types.ObjectId(noteId),
          })
          .lean()
          .exec()
      : null;
    if (!trashed) {
      throw new HttpException('Not in the trash', HttpStatus.NOT_FOUND);
    }
    return trashed;
  }
}
