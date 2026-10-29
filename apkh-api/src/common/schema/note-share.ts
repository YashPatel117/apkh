import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type NoteShareDocument = NoteShare & Document;

/**
 * A read-only link to one note (`/share/<token>`). Anyone with the link can
 * read the note and its attachments until it is revoked or expires. One link
 * per note; making a new one replaces the old link.
 */
@Schema({ timestamps: true })
export class NoteShare {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Random, URL-safe; the link itself, so it's kept to show it again */
  @Prop({ required: true })
  token: string;

  /** null: until revoked */
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  /** Times the link was opened */
  @Prop({ default: 0 })
  views: number;

  @Prop({ type: Date, default: null })
  lastViewedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const NoteShareSchema = SchemaFactory.createForClass(NoteShare);

NoteShareSchema.index({ token: 1 }, { unique: true });
NoteShareSchema.index({ noteId: 1 }, { unique: true });
NoteShareSchema.index({ userId: 1, createdAt: -1 });
// Expired links are removed by MongoDB (links without an expiry are kept).
NoteShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
