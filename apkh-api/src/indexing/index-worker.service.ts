import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Subscription } from 'rxjs';
import { errorMessage } from 'src/common/utils/http-error';
import { ChatIndexerService } from './chat-indexer.service';
import { ClaimedJob, IndexQueueService } from './index-queue.service';
import { NoteIndexerService } from './note-indexer.service';
import { RealtimeService } from 'src/realtime/realtime.service';

// Jobs mostly wait on the provider, so a couple in parallel keeps things moving
// without tripping per-user rate limits.
const CONCURRENCY = 2;
// Fallback poll for retries whose backoff has expired; new work wakes the loop at once.
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_MS = 20_000;
const RECOVERY_INTERVAL_MS = 60_000;

/**
 * Runs queued index jobs in the background. Set INDEX_WORKER=off to run an
 * API instance without it (e.g. a second instance, or tests).
 */
@Injectable()
export class IndexWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(IndexWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly inFlight = new Set<Promise<void>>();
  private running = false;
  private loopDone: Promise<void> | null = null;
  // A wake-up that arrives while the loop is busy is remembered, not lost.
  private woken = false;
  private endSleep: (() => void) | null = null;
  private wakeups: Subscription | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly queue: IndexQueueService,
    private readonly noteIndexer: NoteIndexerService,
    private readonly chatIndexer: ChatIndexerService,
    private readonly realtime: RealtimeService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.INDEX_WORKER === 'off') {
      this.logger.log('Index worker disabled (INDEX_WORKER=off)');
      return;
    }
    this.start();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.wakeups = this.queue.wakeups.subscribe(() => this.wake());
    this.recoveryTimer = setInterval(() => {
      this.queue.recoverStale().catch((err) => {
        this.logger.error(`Stale job recovery failed: ${errorMessage(err)}`);
      });
    }, RECOVERY_INTERVAL_MS);
    this.loopDone = this.loop();
  }

  async stop() {
    this.running = false;
    this.wake();
    this.wakeups?.unsubscribe();
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }
    await this.loopDone;
    await Promise.allSettled([...this.inFlight]);
  }

  private async loop() {
    await this.queue.recoverStale().catch((err) => {
      this.logger.error(`Stale job recovery failed: ${errorMessage(err)}`);
    });

    while (this.running) {
      if (this.inFlight.size < CONCURRENCY) {
        let job: ClaimedJob | null = null;
        try {
          job = await this.queue.claim(this.workerId);
        } catch (err) {
          this.logger.error(
            `Claiming an index job failed: ${errorMessage(err)}`,
          );
        }
        if (job) {
          const run = this.process(job).finally(() => {
            this.inFlight.delete(run);
            this.wake();
          });
          this.inFlight.add(run);
          continue;
        }
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  private async process(job: ClaimedJob) {
    // Open tabs refresh the index status instead of polling for it.
    const notify = () => this.realtime.emit(String(job.userId), 'index:changed');
    notify();
    const heartbeat = setInterval(() => {
      this.queue.heartbeat(job._id, this.workerId).catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      const outcome =
        job.kind === 'note'
          ? await this.noteIndexer.index(job)
          : await this.chatIndexer.index(job);
      await this.queue.complete(job, this.workerId, outcome);
    } catch (error) {
      await this.queue.fail(job, this.workerId, error).catch((err) => {
        this.logger.error(
          `Recording an index failure failed: ${errorMessage(err)}`,
        );
      });
    } finally {
      clearInterval(heartbeat);
      notify();
    }
  }

  private wake() {
    this.woken = true;
    this.endSleep?.();
  }

  private sleep(ms: number) {
    if (this.woken) {
      this.woken = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.endSleep = null;
        this.woken = false;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.endSleep = finish;
    });
  }
}
