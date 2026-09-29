import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type SummaryDocument = Summary & Document;

@Schema({ timestamps: true, collection: 'summary' })
export class Summary {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Note',
    required: true,
    index: true,
  })
  noteId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true })
  summary: string;

  @Prop()
  summaryModel?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SummarySchema = SchemaFactory.createForClass(Summary);

SummarySchema.index({ noteId: 1, userId: 1 }, { unique: true });
