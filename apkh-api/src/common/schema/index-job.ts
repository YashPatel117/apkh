import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type IndexJobDocument = IndexJob & Document;

export type IndexJobKind = 'note' | 'chat';

/**
 * queued: waiting (or waiting to retry) · processing: a worker has it ·
 * ready: indexed · failed: gave up, see `error` · skipped: nothing to index
 * with (no active AI config)
 */
export type IndexJobStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

/**
 * ok: text extracted · empty: nothing readable · unsupported: file type not
 * handled · no_vision: needs a model that reads images · missing: not in
 * storage · failed: download/read error (retried)
 */
export type IndexedFileStatus =
  | 'ok'
  | 'empty'
  | 'unsupported'
  | 'no_vision'
  | 'missing'
  | 'failed';

@Schema({ _id: false })
export class IndexedFile {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  status: IndexedFileStatus;

  @Prop()
  method?: string;

  @Prop({ default: 0 })
  chunkCount: number;

  @Prop()
  warning?: string;

  @Prop()
  error?: string;
}

export const IndexedFileSchema = SchemaFactory.createForClass(IndexedFile);

/**
 * The search index state of one note or chat, which doubles as its queue
 * entry: saving a note (re)queues its job, and the indexing worker claims
 * queued jobs one at a time per target.
 */
@Schema({ timestamps: true, collection: 'index_jobs' })
export class IndexJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['note', 'chat'] })
  kind: IndexJobKind;

  /** The note or chat session */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ required: true, default: 'queued' })
  status: IndexJobStatus;

  /** Re-read every attachment instead of reusing what was extracted before */
  @Prop({ default: false })
  force: boolean;

  /** Attempts of the current run; reset whenever the target changes */
  @Prop({ default: 0 })
  attempts: number;

  /** Earliest time a queued job may run (retry backoff) */
  @Prop({ default: () => new Date() })
  runAt: Date;

  /** 0: a note or chat just changed · 1: bulk reindex. Lower runs first. */
  @Prop({ default: 0 })
  priority: number;

  @Prop()
  lockedAt?: Date;

  @Prop()
  lockedBy?: string;

  /** The target changed while it was being indexed: run again when done */
  @Prop({ default: false })
  requeue: boolean;

  @Prop()
  error?: string;

  @Prop({ default: 0 })
  chunkCount: number;

  /** Embedding space of the stored vectors; null when indexed for keyword search only */
  @Prop({ type: String, default: null })
  embeddingModel: string | null;

  /** Hash of everything the last successful run indexed; equal means nothing to do */
  @Prop()
  sourceHash?: string;

  @Prop()
  indexedAt?: Date;

  @Prop({ type: [IndexedFileSchema], default: [] })
  files: IndexedFile[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const IndexJobSchema = SchemaFactory.createForClass(IndexJob);

IndexJobSchema.index({ kind: 1, targetId: 1 }, { unique: true });
// The worker's claim query
IndexJobSchema.index({ status: 1, priority: 1, runAt: 1 });
// Index status per user
IndexJobSchema.index({ userId: 1, kind: 1 });
