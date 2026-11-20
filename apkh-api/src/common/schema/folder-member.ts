import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type FolderMemberDocument = FolderMember & Document;

export type FolderRole = 'viewer' | 'editor';
export type MemberStatus = 'pending' | 'accepted';

/**
 * Someone a folder is shared with. The folder (with its subfolders and notes)
 * stays its owner's: members read it (viewer) or also change it (editor),
 * once they accept the invite. One row per folder and member.
 */
@Schema({ timestamps: true })
export class FolderMember {
  /** The shared folder; its subfolders are shared with it */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Folder', required: true })
  folderId: Types.ObjectId;

  /** The folder's owner */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  /** The member */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['viewer', 'editor'], required: true })
  role: FolderRole;

  @Prop({ type: String, enum: ['pending', 'accepted'], default: 'pending' })
  status: MemberStatus;

  @Prop({ type: Date, default: null })
  acceptedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FolderMemberSchema = SchemaFactory.createForClass(FolderMember);

FolderMemberSchema.index({ folderId: 1, userId: 1 }, { unique: true });
// What is shared with a user, and their pending invites
FolderMemberSchema.index({ userId: 1, status: 1 });
// Everyone a user shares with (their folders' audiences)
FolderMemberSchema.index({ ownerId: 1, status: 1 });
