import type { IndexedFile } from 'src/common/schema/index-job';

/** What running an index job produced; the queue turns it into the job's next state. */
export type IndexOutcome =
  | {
      kind: 'indexed';
      chunkCount: number;
      /** Space of the stored vectors; null for keyword-only chunks */
      embeddingModel: string | null;
      sourceHash: string;
      files: IndexedFile[];
      /** Some attachments failed in a way worth retrying */
      retryFiles: boolean;
    }
  /** Inputs identical to the last successful run: nothing was done */
  | { kind: 'unchanged' }
  /** The note or chat no longer exists; its chunks were removed */
  | { kind: 'deleted' }
  /** Nothing to index with (e.g. no active AI config) */
  | { kind: 'skipped'; reason: string };
