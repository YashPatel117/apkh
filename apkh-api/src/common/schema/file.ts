import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type NoteFileDocument = NoteFiles & Document;

@Schema()
export class NoteFiles {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, unique: true })
  noteId: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  files: string[];
}

export const NoteFilesSchema = SchemaFactory.createForClass(NoteFiles);
