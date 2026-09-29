import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from 'src/common/schema/chat-message';
import {
  ChatSession,
  ChatSessionDocument,
} from 'src/common/schema/chat-session';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from 'src/common/schema/chunk';
import {
  IndexedFileStatus,
  IndexJob,
  IndexJobDocument,
  IndexJobStatus,
} from 'src/common/schema/index-job';
import { Note, NoteDocument } from 'src/common/schema/note';
import { embeddingSpaceFor } from 'src/search-api/embedding-space';
import { LlmProvider, UsersService } from 'src/users/users.service';
import { ChunkStoreService } from './chunk-store.service';
import { IndexQueueService } from './index-queue.service';

/** A chat is indexed for "related past chats" once it has this many messages. */
export const CHAT_INDEX_MIN_MESSAGES = 10;

// Checking a whole library for notes to (re)index is cheap but not free.
const RECONCILE_INTERVAL_MS = 10 * 60_000;

export interface NoteIndexState {
  noteId: string;
  status: IndexJobStatus;
  error?: string;
  chunkCount: number;
  indexedAt?: Date;
  /** Attachments that were not fully indexed */
  files: {
    name: string;
    status: IndexedFileStatus;
    warning?: string;
    error?: string;
  }[];
}

export interface IndexStatus {
  provider: LlmProvider | null;
  /** The active provider has an embedding model (otherwise keyword search only) */
  semantic: boolean;
  counts: Record<IndexJobStatus, number>;
  notes: NoteIndexState[];
}

/** What other modules use to get notes and chats (re)indexed and to report progress. */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  private readonly lastReconciled = new Map<string, number>();

  constructor(
    private readonly queue: IndexQueueService,
    private readonly chunkStore: ChunkStoreService,
    private readonly usersService: UsersService,
    @InjectModel(IndexJob.name)
    private readonly jobModel: Model<IndexJobDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(KnowledgeChunk.name)
    private readonly chunkModel: Model<KnowledgeChunkDocument>,
    @InjectModel(ChatSession.name)
    private readonly sessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessageDocument>,
  ) {}

  /** Index a note that was just created or edited. */
  enqueueNote(
    userId: string,
    noteId: string,
    options: { force?: boolean } = {},
  ) {
    return this.queue.enqueue('note', userId, noteId, options);
  }

  /** Index (or extend the index of) a chat transcript. */
  enqueueChat(userId: string, sessionId: string) {
    return this.queue.enqueue('chat', userId, sessionId);
  }

  /** Forget a deleted note: its job and chunks. */
  async removeNote(noteId: string) {
    const targetId = new Types.ObjectId(noteId);
    await this.jobModel.deleteOne({ kind: 'note', targetId });
    await this.chunkStore.deleteFor({ noteId: targetId });
  }

  /** Forget a deleted chat: its job and chunks. */
  async removeChat(sessionId: string) {
    const targetId = new Types.ObjectId(sessionId);
    await this.jobModel.deleteOne({ kind: 'chat', targetId });
    await this.chunkStore.deleteFor({ sessionId: targetId });
  }

  /**
   * Re-index every note (and indexed chat) of a user. Without `force` this is
   * cheap: unchanged notes are skipped and stored text is reused. With
   * `force`, every attachment is downloaded and read again.
   */
  async reindexAll(userId: string, options: { force?: boolean } = {}) {
    const userOid = new Types.ObjectId(userId);
    const notes = await this.noteModel
      .find({ userId: userOid })
      .distinct('_id');
    await this.queue.enqueueMany('note', userId, notes.map(String), options);
    const chats = await this.longChats(userOid);
    await this.queue.enqueueMany(
      'chat',
      userId,
      chats.map((chat) => chat.id),
      options,
    );
  }

  /** Retry notes whose indexing failed. */
  async retryFailed(userId: string) {
    const failed = await this.jobModel
      .find({
        userId: new Types.ObjectId(userId),
        kind: 'note',
        $or: [
          { status: 'failed' },
          { status: 'ready', 'files.status': 'failed' },
        ],
      })
      .distinct('targetId');
    await this.queue.enqueueMany('note', userId, failed.map(String));
  }

  /**
   * Bring a user's index in line with their notes and active provider: queue
   * notes that were never indexed (or were indexed by older versions of the
   * app), notes whose vectors are in another embedding space (provider
   * switch), and chats long enough to index; drop jobs of deleted notes.
   * Runs at most every few minutes per user unless forced.
   */
  async reconcileUser(userId: string, options: { force?: boolean } = {}) {
    const now = Date.now();
    if (
      !options.force &&
      now - (this.lastReconciled.get(userId) ?? 0) < RECONCILE_INTERVAL_MS
    ) {
      return;
    }
    this.lastReconciled.set(userId, now);

    const provider = await this.usersService.getActiveProvider(userId);
    if (!provider) {
      return;
    }
    const space = embeddingSpaceFor(provider);
    const userOid = new Types.ObjectId(userId);

    const [notes, jobs, chunkStats] = await Promise.all([
      this.noteModel.find({ userId: userOid }).distinct('_id'),
      this.jobModel
        .find({ userId: userOid, kind: 'note' })
        .select('targetId status embeddingModel')
        .lean()
        .exec(),
      this.chunkModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
          spaces: (string | null)[];
        }>([
          { $match: { userId: userOid, noteId: { $exists: true } } },
          {
            $group: {
              _id: '$noteId',
              count: { $sum: 1 },
              spaces: { $addToSet: { $ifNull: ['$embeddingModel', null] } },
            },
          },
        ])
        .exec(),
    ]);

    const noteIds = new Set(notes.map(String));
    const jobsByNote = new Map(jobs.map((job) => [String(job.targetId), job]));
    const statsByNote = new Map(chunkStats.map((s) => [String(s._id), s]));

    const toQueue: string[] = [];
    const alreadyIndexed: Partial<IndexJob>[] = [];
    for (const noteId of noteIds) {
      const job = jobsByNote.get(noteId);
      const stats = statsByNote.get(noteId);
      if (!job) {
        // Indexed before jobs existed: adopt the chunks if they are usable as-is.
        const usable =
          stats &&
          (space
            ? stats.spaces.length === 1 && stats.spaces[0] === space.id
            : true);
        if (usable) {
          alreadyIndexed.push({
            userId: userOid,
            kind: 'note',
            targetId: new Types.ObjectId(noteId),
            status: 'ready',
            chunkCount: stats.count,
            embeddingModel: space?.id ?? null,
            indexedAt: new Date(),
          });
        } else {
          toQueue.push(noteId);
        }
      } else if (job.status === 'skipped') {
        toQueue.push(noteId);
      } else if (
        space &&
        (job.status === 'ready' || job.status === 'failed') &&
        job.embeddingModel !== space.id
      ) {
        // Keyword-only chunks serve any provider, so only a semantic space needs re-embedding.
        toQueue.push(noteId);
      }
    }

    const orphans = jobs.filter((job) => !noteIds.has(String(job.targetId)));
    for (const orphan of orphans) {
      await this.removeNote(String(orphan.targetId));
    }
    if (alreadyIndexed.length) {
      await this.jobModel
        .insertMany(alreadyIndexed, { ordered: false })
        .catch((error: { code?: number }) => {
          if (error?.code !== 11000) throw error;
        });
    }
    await this.queue.enqueueMany('note', userId, toQueue);

    const chats = (await this.longChats(userOid))
      .filter(({ job }) => {
        if (!job || job.status === 'skipped') return true;
        return (
          Boolean(space) &&
          job.status === 'ready' &&
          job.embeddingModel !== space!.id
        );
      })
      .map((chat) => chat.id);
    await this.queue.enqueueMany('chat', userId, chats);

    if (toQueue.length || chats.length || orphans.length) {
      this.logger.log(
        `Reconciled index for user ${userId}: ${toQueue.length} note(s) and ${chats.length} chat(s) queued, ${orphans.length} orphan(s) removed`,
      );
    }
  }

  async getStatus(userId: string): Promise<IndexStatus> {
    const userOid = new Types.ObjectId(userId);
    const provider = await this.usersService.getActiveProvider(userId);
    const [notes, jobs] = await Promise.all([
      this.noteModel.find({ userId: userOid }).distinct('_id'),
      this.jobModel
        .find({ userId: userOid, kind: 'note' })
        .select('targetId status error chunkCount indexedAt files')
        .lean()
        .exec(),
    ]);
    const jobsByNote = new Map(jobs.map((job) => [String(job.targetId), job]));

    const counts: Record<IndexJobStatus, number> = {
      queued: 0,
      processing: 0,
      ready: 0,
      failed: 0,
      skipped: 0,
    };
    const states = notes.map((id): NoteIndexState => {
      const noteId = (id as Types.ObjectId).toHexString();
      const job = jobsByNote.get(noteId);
      const state: NoteIndexState = job
        ? {
            noteId,
            status: job.status,
            error: job.error,
            chunkCount: job.chunkCount ?? 0,
            indexedAt: job.indexedAt,
            files: (job.files ?? [])
              .filter((f) => f.status !== 'ok' || f.warning)
              .map(({ name, status, warning, error }) => ({
                name,
                status,
                warning,
                error,
              })),
          }
        : provider
          ? // reconcile queues it on its next pass
            { noteId, status: 'queued', chunkCount: 0, files: [] }
          : {
              noteId,
              status: 'skipped',
              error: 'Add an AI key in Profile to index this note.',
              chunkCount: 0,
              files: [],
            };
      counts[state.status]++;
      return state;
    });

    return {
      provider,
      semantic: Boolean(embeddingSpaceFor(provider)),
      counts,
      notes: states,
    };
  }

  /** Index job of a note (null if it has none yet). */
  getNoteJob(noteId: string) {
    return this.jobModel
      .findOne({ kind: 'note', targetId: new Types.ObjectId(noteId) })
      .select('status error files')
      .lean()
      .exec();
  }

  /** Notes of a user still waiting to be (re)indexed. */
  countPendingNotes(userId: string) {
    return this.jobModel.countDocuments({
      userId: new Types.ObjectId(userId),
      kind: 'note',
      status: { $in: ['queued', 'processing'] },
    });
  }

  /** Chats long enough to index, with their index job if they have one. */
  private async longChats(userOid: Types.ObjectId) {
    const sessions = await this.sessionModel
      .find({ userId: userOid })
      .distinct('_id');
    if (!sessions.length) {
      return [];
    }
    const [counts, jobs] = await Promise.all([
      this.messageModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { sessionId: { $in: sessions } } },
          { $group: { _id: '$sessionId', count: { $sum: 1 } } },
        ])
        .exec(),
      this.jobModel
        .find({ kind: 'chat', targetId: { $in: sessions } })
        .select('targetId status embeddingModel')
        .lean()
        .exec(),
    ]);
    const jobsBySession = new Map(
      jobs.map((job) => [String(job.targetId), job]),
    );
    return counts
      .filter((c) => c.count >= CHAT_INDEX_MIN_MESSAGES)
      .map((c) => ({
        id: String(c._id),
        job: jobsBySession.get(String(c._id)),
      }));
  }
}
