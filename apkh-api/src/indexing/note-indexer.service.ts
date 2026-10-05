import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IndexedFile, IndexedFileStatus } from 'src/common/schema/index-job';
import { Note, NoteDocument } from 'src/common/schema/note';
import { sha256 } from 'src/common/utils/content-hash';
import { errorMessage } from 'src/common/utils/http-error';
import { FileService } from 'src/file/file.service';
import { embeddingSpaceFor } from 'src/search-api/embedding-space';
import {
  ExtractedFile,
  SearchApiClient,
} from 'src/search-api/search-api.client';
import { UsersService } from 'src/users/users.service';
import { ChunkPiece, ChunkStoreService } from './chunk-store.service';
import { IndexOutcome } from './index-outcome';
import type { ClaimedJob } from './index-queue.service';
import { ServiceTokenService } from './service-token.service';

// Part of every source hash: bump it when chunking changes so notes re-index.
export const PIPELINE_VERSION = 2;

// Nothing readable last time, and saving the note can't change that: don't
// download these again unless a rebuild is forced.
const SETTLED_FILE_STATUSES: IndexedFileStatus[] = [
  'empty',
  'unsupported',
  'missing',
];

/**
 * Indexes one note incrementally. Attachments that are already indexed are
 * never downloaded or re-read again, unchanged passages keep their vectors,
 * and a save that changes nothing indexable does no work at all.
 */
@Injectable()
export class NoteIndexerService {
  private readonly logger = new Logger(NoteIndexerService.name);

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly fileService: FileService,
    private readonly usersService: UsersService,
    private readonly searchApi: SearchApiClient,
    private readonly chunkStore: ChunkStoreService,
    private readonly serviceTokens: ServiceTokenService,
  ) {}

  async index(job: ClaimedJob): Promise<IndexOutcome> {
    const noteId = job.targetId;
    const note = await this.noteModel
      .findById(noteId)
      .select('userId title content')
      .lean()
      .exec();
    if (!note) {
      await this.chunkStore.deleteFor({ noteId });
      return { kind: 'deleted' };
    }

    const userId = note.userId.toHexString();
    const llm = await this.usersService.getActiveLlmSettings(userId);
    if (!llm) {
      return {
        kind: 'skipped',
        reason: 'Add an AI key in Profile to index this note.',
      };
    }
    const space = embeddingSpaceFor(llm.provider);
    const files =
      (await this.fileService.getNoteFiles(noteId.toHexString()))?.files ?? [];

    const sourceHash = sha256(
      JSON.stringify([
        PIPELINE_VERSION,
        note.title,
        note.content,
        files,
        space?.id ?? null,
      ]),
    );
    if (!job.force && job.sourceHash === sourceHash) {
      return { kind: 'unchanged' };
    }

    const owner = { userId: note.userId, noteId };
    const existing = await this.chunkStore.findExisting(owner);
    const storedFileChunks = groupBy(
      existing.filter((c) => c.sourceType === 'file' && c.sourceName),
      (c) => c.sourceName!,
    );
    const previousFiles = new Map(job.files.map((f) => [f.name, f]));
    const reuse = (name: string) => !job.force && storedFileChunks.has(name);
    const settled = (name: string) =>
      !job.force &&
      SETTLED_FILE_STATUSES.includes(
        previousFiles.get(name)?.status as IndexedFileStatus,
      );

    const token = this.serviceTokens.forUser(userId);
    let tokensUsed = 0;

    const toExtract = files.filter((name) => !reuse(name) && !settled(name));
    let extracted: ExtractedFile[] = [];
    if (toExtract.length) {
      const result = await this.searchApi.extractFiles(token, llm, {
        noteId: noteId.toHexString(),
        userId,
        files: toExtract,
      });
      extracted = result.files;
      tokensUsed += result.tokensUsed;
    }
    const extractedByName = new Map(extracted.map((f) => [f.file_name, f]));

    const chunks = await this.searchApi.chunk(token, {
      content: note.content,
      contentFormat: 'html',
      sourceType: 'note',
      files: extracted
        .filter((f) => f.text)
        .map((f) => ({ name: f.file_name, text: f.text })),
    });
    const newFileChunks = groupBy(
      chunks.filter((c) => c.source_type === 'file' && c.source_name),
      (c) => c.source_name!,
    );

    const pieces: ChunkPiece[] = chunks
      .filter((c) => c.source_type === 'note')
      .map((c) => ({ sourceType: 'note', text: c.text }));
    const fileResults: IndexedFile[] = [];

    for (const name of files) {
      if (reuse(name)) {
        const stored = storedFileChunks.get(name)!;
        pieces.push(
          ...stored.map((c) => fileChunk(name, c.text, c.sourcePage)),
        );
        fileResults.push({
          ...(previousFiles.get(name) ?? { name, status: 'ok' }),
          chunkCount: stored.length,
        });
      } else if (settled(name)) {
        fileResults.push(previousFiles.get(name)!);
      } else {
        const result = extractedByName.get(name);
        const fresh = newFileChunks.get(name) ?? [];
        pieces.push(
          ...fresh.map((c) =>
            fileChunk(name, c.text, c.source_page ?? undefined),
          ),
        );
        fileResults.push(toIndexedFile(name, result, fresh.length));
      }
    }

    // A note with no text still needs one chunk to be findable by its title.
    if (!pieces.length) {
      pieces.push({ sourceType: 'note', text: note.title });
    }

    const stored = await this.chunkStore.replace({
      token,
      llm,
      space,
      owner,
      title: note.title,
      pieces,
      existing,
      stillExists: async () =>
        Boolean(await this.noteModel.exists({ _id: noteId })),
    });
    if (stored.chunkCount === null) {
      return { kind: 'deleted' };
    }
    tokensUsed += stored.tokensUsed;
    // Indexing never counts toward the plan's session allowance.
    this.usersService
      .addTokenUsage(userId, tokensUsed, llm, {
        interactive: false,
        kind: 'index',
      })
      .catch((err) => {
        this.logger.error(
          `Failed to track indexing tokens: ${errorMessage(err)}`,
        );
      });

    this.logger.log(
      `Indexed note ${noteId.toHexString()}: ${stored.chunkCount} chunks, ${stored.embedded} embedded, ` +
        `${toExtract.length}/${files.length} attachment(s) read` +
        (stored.needsCredit
          ? ' (no credit for embeddings: keyword search only)'
          : ''),
    );

    const retryFiles = fileResults.some((f) => f.status === 'failed');
    return {
      kind: 'indexed',
      chunkCount: stored.chunkCount,
      embeddingModel: space?.id ?? null,
      // Without a hash the next run retries the failed attachments.
      sourceHash: retryFiles ? '' : sourceHash,
      files: fileResults,
      retryFiles,
    };
  }
}

function fileChunk(name: string, text: string, page?: number): ChunkPiece {
  return { sourceType: 'file', sourceName: name, sourcePage: page, text };
}

function toIndexedFile(
  name: string,
  result: ExtractedFile | undefined,
  chunkCount: number,
): IndexedFile {
  if (!result) {
    return {
      name,
      status: 'failed',
      chunkCount,
      error: 'The file was not processed.',
    };
  }
  const file: IndexedFile = { name, status: result.status, chunkCount };
  if (result.method) file.method = result.method;
  if (result.warning) file.warning = result.warning;
  if (result.error) file.error = result.error;
  return file;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) {
      group.push(item);
    } else {
      groups.set(key(item), [item]);
    }
  }
  return groups;
}
