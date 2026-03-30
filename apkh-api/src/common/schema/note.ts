import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import striptags from 'striptags';

export type NoteDocument = Note & Document;

@Schema({ timestamps: true })
export class Note {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
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
    this.contentPlain = striptags(this.content);
  }
  next();
});

// Create a text index
NoteSchema.index({ title: 'text', category: 'text', contentPlain: 'text' });
