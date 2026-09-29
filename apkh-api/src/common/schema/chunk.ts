import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type KnowledgeChunkDocument = KnowledgeChunk & Document;

export type ChunkSourceType = 'note' | 'file' | 'chat';

/**
 * A searchable passage of a note, one of its attachments, or a chat
 * transcript. The text is kept so a chunk can be re-embedded (e.g. after a
 * provider switch) without downloading or re-reading its file.
 */
@Schema({ timestamps: true })
export class KnowledgeChunk {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Set for note and file chunks */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Note' })
  noteId?: Types.ObjectId;

  /** Set for chat transcript chunks */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ChatSession' })
  sessionId?: Types.ObjectId;

  @Prop({ required: true, enum: ['note', 'file', 'chat'] })
  sourceType: ChunkSourceType;

  /** Title of the note or chat, shown with search results */
  @Prop({ required: true })
  noteTitle: string;

  @Prop({ required: true })
  chunkIndex: number;

  @Prop({ required: true })
  text: string;

  /** sha256 of `text`: an unchanged passage reuses its stored vector */
  @Prop({ required: true })
  textHash: string;

  /** Attachment file name (file chunks) */
  @Prop()
  sourceName?: string;

  /** PDF page (file chunks) */
  @Prop()
  sourcePage?: number;

  /**
   * Embedding space of `vector`, e.g. "gemini-embedding-001@1536". Vectors are
   * only compared within one space. Unset for keyword-only chunks (providers
   * without an embedding model).
   */
  @Prop()
  embeddingModel?: string;

  /** L2-normalised float32 vector, stored as a BSON binary vector (subtype 9) */
  @Prop({ type: MongooseSchema.Types.Mixed })
  vector?: unknown;
}

export const KnowledgeChunkSchema =
  SchemaFactory.createForClass(KnowledgeChunk);

// A note's chunks in order (re-indexing, summaries)
KnowledgeChunkSchema.index({ noteId: 1, chunkIndex: 1 });
// A chat's chunks
KnowledgeChunkSchema.index({ sessionId: 1 });
// Semantic search: a user's vectors in one embedding space
KnowledgeChunkSchema.index({ userId: 1, embeddingModel: 1, sourceType: 1 });
// Keyword search (the keyword half of hybrid search, and all of it for Claude)
KnowledgeChunkSchema.index(
  { userId: 1, text: 'text', noteTitle: 'text', sourceName: 'text' },
  {
    name: 'chunk_keyword_search',
    weights: { noteTitle: 3, sourceName: 2, text: 1 },
  },
);
