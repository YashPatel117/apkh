import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { htmlToPlainText } from '../utils/html';

export type NoteDocument = Note & Document;

@Schema({ timestamps: true })
export class Note {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string; // HTML

  @Prop()
  contentPlain: string; // Text only

  @Prop({ required: true })
  category: string;

  createdAt: string;
  updatedAt: string;
}

export const NoteSchema = SchemaFactory.createForClass(Note);

NoteSchema.pre('save', function (next) {
  if (this.content) {
    this.contentPlain = htmlToPlainText(this.content);
  }
  next();
});

// Create a text index
NoteSchema.index({ title: 'text', category: 'text', contentPlain: 'text' });
// Listing a user's notes and finding their latest change
NoteSchema.index({ userId: 1, updatedAt: -1 });
