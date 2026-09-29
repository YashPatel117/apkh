import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { Subject } from 'rxjs';
import {
  IndexJob,
  IndexJobDocument,
  IndexJobKind,
} from 'src/common/schema/index-job';
import { errorMessage } from 'src/common/utils/http-error';
import { SearchApiError } from 'src/search-api/search-api.client';
import { IndexOutcome } from './index-outcome';

/** Attempts per run before a job is marked failed. */
export const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
/** A processing job whose worker stopped sending heartbeats (crash, restart) is requeued. */
export const STALE_LOCK_MS = 2 * 60_000;

const INTERACTIVE = 0;
const BULK = 1;

export type ClaimedJob = IndexJob & { _id: Types.ObjectId };

type JobUpdate = { $set: Record<string, unknown>; $unset: Record<string, 1> };

/**
 * The indexing queue, kept in the index_jobs collection: one job per note or
 * chat, which is also that target's index status. Every transition is a
 * single atomic update, so several API instances can share the queue.
 */
@Injectable()
export class IndexQueueService {
  private readonly logger = new Logger(IndexQueueService.name);

  /** Emits when work may be available, to wake an idle worker. */
  readonly wakeups = new Subject<void>();

  constructor(
    @InjectModel(IndexJob.name)
    private readonly jobModel: Model<IndexJobDocument>,
  ) {}

  /**
   * Queue indexing of a target that just changed. A job already being
   * processed is flagged to run again when it finishes instead, so a target
   * never has two runs at once and the latest change always gets indexed.
   */
  async enqueue(
    kind: IndexJobKind,
    userId: string,
    targetId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const target = new Types.ObjectId(targetId);
    const force = options.force ? { force: true } : {};

    for (let attempt = 0; attempt < 3; attempt++) {
      const running = await this.jobModel.updateOne(
        { kind, targetId: target, status: 'processing' },
        { $set: { requeue: true, ...force } },
      );
      if (running.matchedCount) {
        return;
      }

      try {
        await this.jobModel.updateOne(
          { kind, targetId: target, status: { $ne: 'processing' } },
          {
            $set: {
              userId: new Types.ObjectId(userId),
              status: 'queued',
              priority: INTERACTIVE,
              runAt: new Date(),
              attempts: 0,
              requeue: false,
              ...force,
            },
            $unset: { error: 1 },
          },
          { upsert: true },
        );
        this.wakeups.next();
        return;
      } catch (error) {
        // Claimed by a worker between the two updates: flag it on the next pass.
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }
    }
  }

  /**
   * Queue many targets behind interactive work (reindex after a provider
   * switch, "rebuild index"). Targets already queued keep their place.
   */
  async enqueueMany(
    kind: IndexJobKind,
    userId: string,
    targetIds: string[],
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (!targetIds.length) {
      return;
    }
    const targets = targetIds.map((id) => new Types.ObjectId(id));
    const force = options.force ? { force: true } : {};

    await this.jobModel.updateMany(
      { kind, targetId: { $in: targets }, status: 'processing' },
      { $set: { requeue: true, ...force } },
    );
    if (options.force) {
      await this.jobModel.updateMany(
        { kind, targetId: { $in: targets }, status: 'queued' },
        { $set: force },
      );
    }
    await this.jobModel.updateMany(
      {
        kind,
        targetId: { $in: targets },
        status: { $in: ['ready', 'failed', 'skipped'] },
      },
      {
        $set: {
          status: 'queued',
          priority: BULK,
          runAt: new Date(),
          attempts: 0,
          requeue: false,
          ...force,
        },
        $unset: { error: 1 },
      },
    );

    const existing = new Set(
      (
        await this.jobModel.distinct('targetId', {
          kind,
          targetId: { $in: targets },
        })
      ).map(String),
    );
    const missing = targets.filter((id) => !existing.has(id.toHexString()));
    if (missing.length) {
      try {
        await this.jobModel.insertMany(
          missing.map((targetId) => ({
            userId: new Types.ObjectId(userId),
            kind,
            targetId,
            status: 'queued',
            priority: BULK,
            runAt: new Date(),
            ...force,
          })),
          { ordered: false },
        );
      } catch (error) {
        // Another request created some of them meanwhile; those are queued too.
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }
    }
    this.wakeups.next();
  }

  /** Take the next runnable job (interactive before bulk, oldest first). */
  async claim(workerId: string): Promise<ClaimedJob | null> {
    const now = new Date();
    return this.jobModel
      .findOneAndUpdate(
        { status: 'queued', runAt: { $lte: now } },
        {
          $set: {
            status: 'processing',
            lockedAt: now,
            lockedBy: workerId,
            requeue: false,
          },
          $inc: { attempts: 1 },
        },
        { sort: { priority: 1, runAt: 1 }, new: true },
      )
      .lean<ClaimedJob>()
      .exec();
  }

  /** Keep a long-running job from being taken for stale. */
  async heartbeat(jobId: Types.ObjectId, workerId: string): Promise<void> {
    await this.jobModel.updateOne(
      { _id: jobId, lockedBy: workerId },
      { $set: { lockedAt: new Date() } },
      { timestamps: false },
    );
  }

  /** Requeue jobs left in processing by a worker that stopped (crash, restart). */
  async recoverStale(): Promise<number> {
    const result = await this.jobModel.updateMany(
      {
        status: 'processing',
        lockedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) },
      },
      {
        $set: { status: 'queued', runAt: new Date() },
        $unset: { lockedAt: 1, lockedBy: 1 },
      },
    );
    if (result.modifiedCount) {
      this.logger.warn(`Requeued ${result.modifiedCount} stalled index job(s)`);
      this.wakeups.next();
    }
    return result.modifiedCount;
  }

  /** Record the result of a run. */
  async complete(
    job: ClaimedJob,
    workerId: string,
    outcome: IndexOutcome,
  ): Promise<void> {
    const mine = { _id: job._id, lockedBy: workerId };

    if (outcome.kind === 'deleted') {
      await this.jobModel.deleteOne(mine);
      return;
    }

    const next: JobUpdate = { $set: {}, $unset: { lockedAt: 1, lockedBy: 1 } };
    if (outcome.kind === 'skipped') {
      Object.assign(next.$set, {
        status: 'skipped',
        error: outcome.reason,
        attempts: 0,
        force: false,
      });
    } else if (outcome.kind === 'unchanged') {
      Object.assign(next.$set, { status: 'ready', attempts: 0, force: false });
      next.$unset.error = 1;
    } else {
      Object.assign(next.$set, {
        chunkCount: outcome.chunkCount,
        embeddingModel: outcome.embeddingModel,
        files: outcome.files,
        indexedAt: new Date(),
        force: false,
      });
      if (outcome.sourceHash) {
        next.$set.sourceHash = outcome.sourceHash;
      } else {
        next.$unset.sourceHash = 1;
      }

      const failedFiles = outcome.files.filter((f) => f.status === 'failed');
      if (outcome.retryFiles && job.attempts < MAX_ATTEMPTS) {
        Object.assign(next.$set, {
          status: 'queued',
          runAt: new Date(Date.now() + retryDelay(job.attempts)),
          error: describeFailedFiles(failedFiles),
        });
      } else {
        Object.assign(next.$set, { status: 'ready', attempts: 0 });
        if (failedFiles.length) {
          next.$set.error = describeFailedFiles(failedFiles);
        } else {
          next.$unset.error = 1;
        }
      }
    }

    await this.finish(job, workerId, next);
  }

  /** Record a failed run: retry with backoff, or give up after MAX_ATTEMPTS. */
  async fail(job: ClaimedJob, workerId: string, error: unknown): Promise<void> {
    const retryable = error instanceof SearchApiError ? error.retryable : true;
    const message = errorMessage(error);
    const next: JobUpdate = {
      $set: { error: message },
      $unset: { lockedAt: 1, lockedBy: 1 },
    };
    if (retryable && job.attempts < MAX_ATTEMPTS) {
      Object.assign(next.$set, {
        status: 'queued',
        runAt: new Date(Date.now() + retryDelay(job.attempts)),
      });
    } else {
      Object.assign(next.$set, { status: 'failed', attempts: 0 });
    }
    this.logger.warn(
      `Index job ${job.kind}:${String(job.targetId)} failed (attempt ${job.attempts}): ${message}`,
    );
    await this.finish(job, workerId, next);
  }

  /**
   * Apply the job's next state — unless its target changed while it ran
   * (`requeue`), in which case it goes straight back to the queue.
   */
  private async finish(
    job: ClaimedJob,
    workerId: string,
    next: JobUpdate,
  ): Promise<void> {
    const done = await this.jobModel.updateOne(
      { _id: job._id, lockedBy: workerId, requeue: false },
      next as UpdateQuery<IndexJobDocument>,
    );
    if (done.matchedCount) {
      return;
    }

    const requeued = await this.jobModel.updateOne(
      { _id: job._id, lockedBy: workerId },
      {
        $set: {
          ...next.$set,
          status: 'queued',
          priority: INTERACTIVE,
          runAt: new Date(),
          attempts: 0,
          requeue: false,
        },
        $unset: next.$unset,
      },
    );
    if (requeued.matchedCount) {
      this.wakeups.next();
    }
  }
}

function retryDelay(attempts: number): number {
  return Math.min(
    BASE_RETRY_DELAY_MS * 2 ** Math.max(attempts - 1, 0),
    MAX_RETRY_DELAY_MS,
  );
}

function describeFailedFiles(
  files: { name: string; error?: string }[],
): string {
  return files
    .map((f) => `${f.name}: ${f.error ?? 'could not be read'}`)
    .join('; ');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}
