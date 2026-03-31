import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KnowledgeChunkDocument = KnowledgeChunk & Document;

@Schema({ timestamps: true })
export class KnowledgeChunk {
  @Prop({ type: Types.ObjectId, ref: 'Note', required: true, index: true })
  noteId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  noteTitle: string;

  @Prop({ required: true })
  chunkIndex: number;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true, enum: ['note', 'file'] })
  sourceType: string;

  @Prop()
  sourceName: string;

  @Prop()
  sourcePage: number;

  @Prop({ type: [Number], required: true })
  embedding: number[]; // 768-dim vector from Gemini text-embedding-004
}

export const KnowledgeChunkSchema =
  SchemaFactory.createForClass(KnowledgeChunk);

// Index for fast lookups by noteId (for delete-before-insert)
KnowledgeChunkSchema.index({ noteId: 1 });
// Index for user-scoped queries
KnowledgeChunkSchema.index({ userId: 1 });
