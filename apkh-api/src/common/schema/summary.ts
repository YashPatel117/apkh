import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type SummaryDocument = Summary & Document;

/** brief: a compact summary · actions: action items first */
export type SummaryMode = 'brief' | 'actions';
export const SUMMARY_MODES: SummaryMode[] = ['brief', 'actions'];

/** Action items extracted from a note (only what the note says). */
export interface NoteActions {
  tasks: {
    task: string;
    owner: string | null;
    due: string | null;
    done: boolean;
  }[];
  decisions: string[];
  deadlines: { what: string; when: string }[];
  people: { name: string; role: string | null }[];
}

/** A cached summary of a note, one per mode; cleared when the note changes. */
@Schema({ timestamps: true, collection: 'summary' })
export class Summary {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Note',
    required: true,
    index: true,
  })
  noteId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: SUMMARY_MODES, default: 'brief' })
  mode: SummaryMode;

  /** The summary; in actions mode a sentence or two on what the note is about */
  @Prop({ default: '' })
  summary: string;

  /** mode "actions": the extracted items */
  @Prop({ type: MongooseSchema.Types.Mixed })
  actions?: NoteActions;

  @Prop()
  summaryModel?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SummarySchema = SchemaFactory.createForClass(Summary);

SummarySchema.index({ noteId: 1, userId: 1, mode: 1 }, { unique: true });
