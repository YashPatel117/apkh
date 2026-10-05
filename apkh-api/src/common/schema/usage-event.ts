import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type UsageEventDocument = UsageEvent & Document;

export const USAGE_KINDS = [
  'search',
  'chat',
  'summary',
  'rewrite',
  'index',
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** One AI request: what it was for, which model, and the tokens it used. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class UsageEvent {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: USAGE_KINDS })
  kind: UsageKind;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  model: string;

  @Prop({ default: 0 })
  tokens: number;

  /** The question, for searches and chat messages (shortened) */
  @Prop()
  query?: string;

  createdAt: Date;
}

export const UsageEventSchema = SchemaFactory.createForClass(UsageEvent);

UsageEventSchema.index({ userId: 1, createdAt: -1 });
// Usage history is kept for about a year.
UsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86_400 });
