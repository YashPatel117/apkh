import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type AnswerFeedbackDocument = AnswerFeedback & Document;

export const FEEDBACK_KINDS = ['search', 'chat'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * A user's vote on one AI answer (AI search or a chat reply), kept with the
 * question and the answer so unhelpful ones can be found and looked into in
 * the admin panel. One vote per answer: voting again replaces it.
 */
@Schema({ collection: 'answerfeedback', timestamps: true })
export class AnswerFeedback {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: FEEDBACK_KINDS })
  kind: FeedbackKind;

  /** Identifies the answer: a chat message id, or a hash of question and answer */
  @Prop({ required: true })
  answerKey: string;

  @Prop({ required: true })
  helpful: boolean;

  @Prop({ default: '' })
  query: string;

  @Prop({ default: '' })
  answer: string;

  @Prop()
  comment?: string;

  @Prop({ default: 0 })
  sourceCount: number;

  /** The model that was active when the vote was cast */
  @Prop()
  model?: string;

  @Prop()
  provider?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  sessionId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const AnswerFeedbackSchema =
  SchemaFactory.createForClass(AnswerFeedback);

AnswerFeedbackSchema.index({ userId: 1, answerKey: 1 }, { unique: true });
AnswerFeedbackSchema.index({ helpful: 1, updatedAt: -1 });
