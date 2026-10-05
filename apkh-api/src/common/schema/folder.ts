import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type FolderDocument = Folder & Document;

/** A collection of notes. Folders nest through `parentId` (null: top level). */
@Schema({ timestamps: true })
export class Folder {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Folder', default: null })
  parentId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FolderSchema = SchemaFactory.createForClass(Folder);

FolderSchema.index({ userId: 1, parentId: 1, name: 1 });
