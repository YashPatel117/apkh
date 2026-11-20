import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type NoteVersionDocument = NoteVersion & Document;

/**
 * A note as it was before an edit. Every update stores the previous title,
 * category and content, so any earlier version can be compared or restored.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class NoteVersion {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  category: string;

  @Prop({ required: true })
  content: string;

  /** Who wrote this version (the note's lastEditedBy at the time), when known */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  editedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  editedByName: string | null;

  /** When this version was current: the note's updatedAt at the time */
  @Prop({ required: true })
  savedAt: Date;

  createdAt: Date;
}

export const NoteVersionSchema = SchemaFactory.createForClass(NoteVersion);

NoteVersionSchema.index({ noteId: 1, savedAt: -1 });
