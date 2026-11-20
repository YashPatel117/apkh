import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationDocument = AppNotification & Document;

export type NotificationKind =
  /** Someone invited you to a folder: accept or decline */
  | 'folder-invite'
  /** Someone accepted / declined your invite */
  | 'invite-accepted'
  | 'invite-declined'
  /** The owner changed your role, or removed you */
  | 'role-changed'
  | 'member-removed'
  /** A member left your folder */
  | 'member-left'
  /** The owner deleted a folder you were in */
  | 'folder-deleted';

/**
 * An in-app notification (the bell in the sidebar). Names are copied in, so
 * a notification still reads right after the folder or person is gone.
 * Deleted by MongoDB 90 days after it was created.
 */
@Schema({
  collection: 'notifications',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AppNotification {
  /** Who it is for */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  kind: NotificationKind;

  /** Who caused it */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ default: '' })
  actorName: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Folder', default: null })
  folderId: Types.ObjectId | null;

  @Prop({ default: '' })
  folderName: string;

  @Prop({ type: String, default: null })
  role: string | null;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(AppNotification);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 3600 },
);
