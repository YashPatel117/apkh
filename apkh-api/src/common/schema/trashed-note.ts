import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type TrashedNoteDocument = TrashedNote & Document;

/**
 * A deleted note, kept so it can be restored. Deleting moves the note here and
 * out of the search index; its attachments and version history stay where
 * they are. Restoring puts it back under its old id; after the retention
 * period (TRASH_RETENTION_DAYS) it is purged with its files and history.
 */
@Schema({ collection: 'trashednotes' })
export class TrashedNote {
  /** The note's own id, kept for the restore */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, unique: true })
  noteId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: '' })
  category: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Folder', default: null })
  folderId: Types.ObjectId | null;

  @Prop({ required: true })
  noteCreatedAt: Date;

  @Prop({ required: true })
  noteUpdatedAt: Date;

  @Prop({ required: true })
  deletedAt: Date;
}

export const TrashedNoteSchema = SchemaFactory.createForClass(TrashedNote);

// The trash list (newest first) and the purge of expired notes
TrashedNoteSchema.index({ userId: 1, deletedAt: -1 });
TrashedNoteSchema.index({ deletedAt: 1 });
