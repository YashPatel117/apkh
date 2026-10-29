import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from 'src/common/schema/note';
import { FileService } from 'src/file/file.service';
import { FoldersService } from 'src/folders/folders.service';
import { IndexingService } from 'src/indexing/indexing.service';
import { ServiceTokenService } from 'src/indexing/service-token.service';
import { RealtimeService } from 'src/realtime/realtime.service';
import { errorMessage } from 'src/common/utils/http-error';
import { resolveNoteMetadata } from '../utils/note-metadata';
import { normalizeTags } from '../utils/tags';
import { escapeHtml } from './import-html';
import {
  ImportError,
  ImportSkip,
  ImportSource,
  ImportedNote,
  parseImport,
} from './parse-import';

// Attachments sent to storage per request (its per-request limit).
const UPLOAD_BATCH = Number(process.env.MAX_FILES_PER_UPLOAD) || 10;
// Skipped items listed in the response; the rest are only counted.
const MAX_LISTED_SKIPS = 50;
const MAX_FOLDER_NAME = 80;

export interface ImportResult {
  source: ImportSource;
  /** Folder the notes went into (null: top level) */
  folderId: string | null;
  folderName: string | null;
  notes: number;
  folders: number;
  attachments: number;
  skipped: ImportSkip[];
  skippedCount: number;
}

/**
 * Imports another app's export: Obsidian vaults, Notion and NotebookLM
 * exports, Evernote .enex files, or any ZIP of Markdown / HTML / text files.
 * Notes keep their folders, tags, dates, links and attachments, and are
 * indexed in the background like notes saved in the app.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly folders: FoldersService,
    private readonly fileService: FileService,
    private readonly indexing: IndexingService,
    private readonly serviceTokens: ServiceTokenService,
    private readonly realtime: RealtimeService,
  ) {}

  async import(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<ImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Choose an export file to import.');
    }
    const parsed = await parseImport(file.buffer, file.originalname).catch(
      (error: unknown) => {
        if (error instanceof ImportError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      },
    );
    if (!parsed.notes.length) {
      throw new BadRequestException(
        parsed.skipped[0]?.reason ?? 'No notes were found in the file.',
      );
    }

    const skipped = [...parsed.skipped];
    const folderIdFor = await this.folderMaker(userId, parsed.rootName);
    const existingCategories: string[] = await this.noteModel.distinct(
      'category',
      { userId: new Types.ObjectId(userId) },
    );
    // Uploads on the user's behalf; storage doesn't rate-limit these.
    const token = this.serviceTokens.forUser(userId);
    const created: string[] = [];
    let attachments = 0;
    let storageFull = false;

    for (const note of parsed.notes) {
      const doc = await this.saveNote(
        userId,
        note,
        await folderIdFor(note.folder),
        existingCategories,
      );
      created.push(String(doc._id));

      const failed = new Set<string>();
      for (let i = 0; i < note.attachments.length; i += UPLOAD_BATCH) {
        const batch = note.attachments.slice(i, i + UPLOAD_BATCH);
        if (storageFull) {
          batch.forEach((a) => {
            failed.add(a.id);
            skipped.push({
              name: `${note.title} / ${a.name}`,
              reason: 'Storage is full.',
            });
          });
          continue;
        }
        try {
          const files = await Promise.all(
            batch.map(
              async (a) =>
                ({
                  buffer: await a.read(),
                  originalname: a.id,
                }) as Express.Multer.File,
            ),
          );
          await this.fileService.upload(token, String(doc._id), files);
          attachments += batch.length;
        } catch (error) {
          const reason =
            error instanceof HttpException
              ? error.message
              : errorMessage(error);
          if (/storage full/i.test(reason)) storageFull = true;
          batch.forEach((a) => {
            failed.add(a.id);
            skipped.push({ name: `${note.title} / ${a.name}`, reason });
          });
        }
      }
      // Chips of files that couldn't be stored are taken out of the note.
      if (failed.size) {
        doc.content = withoutChips(doc.content, failed);
        await doc.save({ timestamps: false });
      }
    }

    await this.indexing
      .enqueueNotes(userId, created)
      .catch((error) =>
        this.logger.error(
          `Queueing ${created.length} imported notes failed: ${errorMessage(error)}`,
        ),
      );
    this.realtime.emit(userId, 'notes:refresh');
    this.realtime.emit(userId, 'folders:changed');

    const root = folderIdFor.root();
    return {
      source: parsed.source,
      folderId: root?.id ?? null,
      folderName: root?.name ?? null,
      notes: created.length,
      folders: folderIdFor.created(),
      attachments,
      skipped: skipped.slice(0, MAX_LISTED_SKIPS),
      skippedCount: skipped.length,
    };
  }

  private async saveNote(
    userId: string,
    note: ImportedNote,
    folderId: Types.ObjectId | null,
    existingCategories: string[],
  ) {
    const metadata = resolveNoteMetadata({
      title: note.title,
      category: note.category,
      content: note.content,
      existingCategories,
    });
    if (!existingCategories.includes(metadata.category)) {
      existingCategories.push(metadata.category);
    }
    const createdAt = validDate(note.createdAt) ?? new Date();
    const doc = new this.noteModel({
      _id: note.id,
      userId: new Types.ObjectId(userId),
      title: metadata.title,
      content: note.content || '<p></p>',
      category: metadata.category,
      tags: normalizeTags(note.tags),
      folderId,
      // The dates the other app had, so imported notes sort where they belong.
      createdAt,
      updatedAt: validDate(note.updatedAt) ?? createdAt,
    });
    await doc.save({ timestamps: false });
    return doc;
  }

  /**
   * Folder ids by path under one new folder for the import. Each path is made
   * once; paths deeper than folders can go are filed in their deepest folder.
   */
  private async folderMaker(userId: string, rootName: string) {
    const ids = new Map<string, Types.ObjectId | null>();
    let made = 0;
    let root: { id: string; name: string } | null = null;

    if (rootName) {
      const existing = new Set(
        (await this.folders.list(userId))
          .filter((f) => !f.parentId)
          .map((f) => f.name.toLowerCase()),
      );
      // Importing the same export again goes into a folder of its own.
      let name = rootName.slice(0, MAX_FOLDER_NAME);
      for (let n = 2; existing.has(name.toLowerCase()); n++) {
        name = `${rootName.slice(0, MAX_FOLDER_NAME - 5)} (${n})`;
      }
      const folder = await this.folders.create(userId, name, null);
      root = folder;
      made++;
    }
    ids.set('', root ? new Types.ObjectId(root.id) : null);

    const folderIdFor = async (path: string[]) => {
      const parts = path
        .map((p) => p.trim().slice(0, MAX_FOLDER_NAME))
        .filter(Boolean);
      let parent = ids.get('') ?? null;
      for (let depth = 1; depth <= parts.length; depth++) {
        const key = parts.slice(0, depth).join('\u0000');
        if (ids.has(key)) {
          parent = ids.get(key) ?? null;
          continue;
        }
        try {
          const folder = await this.folders.create(
            userId,
            parts[depth - 1],
            parent ? parent.toHexString() : null,
          );
          parent = new Types.ObjectId(folder.id);
          made++;
        } catch {
          // Too deep: this path and everything under it stays in `parent`.
        }
        ids.set(key, parent);
      }
      return parent;
    };
    folderIdFor.root = () => root;
    folderIdFor.created = () => made;
    return folderIdFor;
  }
}

function validDate(date: Date | undefined): Date | undefined {
  return date && !Number.isNaN(date.getTime()) && date.getTime() <= Date.now()
    ? date
    : undefined;
}

function withoutChips(html: string, ids: Set<string>): string {
  return html.replace(
    /<span class="file-token" data-id="([^"]*)"[^>]*>[\s\S]*?<\/span>/g,
    (match, id: string) =>
      [...ids].some((removed) => escapeHtml(removed) === id) ? '' : match,
  );
}
