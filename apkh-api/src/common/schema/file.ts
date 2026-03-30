import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NoteFileDocument = NoteFiles & Document;

@Schema()
export class NoteFiles {
  @Prop({ required: true, type: Types.ObjectId })
  noteId: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  files: string[];
}

export const NoteFilesSchema = SchemaFactory.createForClass(NoteFiles);
